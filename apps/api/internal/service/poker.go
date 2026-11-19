package service

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Devlaner/devlane/api/internal/model"
	"github.com/Devlaner/devlane/api/internal/realtime"
	"github.com/Devlaner/devlane/api/internal/store"
	"github.com/google/uuid"
)

var (
	ErrPokerNoRound   = errors.New("no active planning poker round")
	ErrPokerBadCard   = errors.New("invalid card")
	ErrPokerState     = errors.New("action not allowed in the current round state")
	ErrPokerForbidden = errors.New("only the round starter or a workspace admin can do this")
)

// Special non-numeric cards, always available and never used as a final estimate.
const (
	pokerUnsure = "?"
	pokerBreak  = "☕"
)

var defaultPokerDeck = []string{"0", "1", "2", "3", "5", "8", "13", "21"}

// PokerCard is a selectable card. EstimatePointID links it to the project's
// estimate scale so finalizing can set the work item's estimate.
type PokerCard struct {
	Value           string     `json:"value"`
	EstimatePointID *uuid.UUID `json:"estimate_point_id,omitempty"`
	Special         bool       `json:"special,omitempty"`
}

// PokerParticipant: Value is only populated once the round is revealed.
type PokerParticipant struct {
	UserID uuid.UUID `json:"user_id"`
	Voted  bool      `json:"voted"`
	Value  *string   `json:"value,omitempty"`
}

type PokerStats struct {
	Average      *float64 `json:"average,omitempty"`
	Min          *float64 `json:"min,omitempty"`
	Max          *float64 `json:"max,omitempty"`
	Consensus    bool     `json:"consensus"`
	NumericVotes int      `json:"numeric_votes"`
	Suggested    *string  `json:"suggested,omitempty"`
}

// PokerState is everything the UI needs for one work item.
type PokerState struct {
	Round        *model.PokerRound  `json:"round"`
	Cards        []PokerCard        `json:"cards"`
	Participants []PokerParticipant `json:"participants"`
	MyVote       *string            `json:"my_vote,omitempty"`
	Stats        *PokerStats        `json:"stats,omitempty"`
	CanManage    bool               `json:"can_manage"`
	History      []model.PokerRound `json:"history"`
}

// PokerService runs backlog-refinement planning poker on a work item.
type PokerService struct {
	ps       *store.PokerStore
	issues   *IssueService
	estimate *EstimateService
	projects *store.ProjectStore
	ws       *store.WorkspaceStore
	notify   *NotificationService
	hub      *realtime.Hub
}

func NewPokerService(ps *store.PokerStore, issues *IssueService, estimate *EstimateService, projects *store.ProjectStore, ws *store.WorkspaceStore) *PokerService {
	return &PokerService{ps: ps, issues: issues, estimate: estimate, projects: projects, ws: ws}
}

func (s *PokerService) SetNotificationService(n *NotificationService) { s.notify = n }
func (s *PokerService) SetHub(h *realtime.Hub)                        { s.hub = h }

// cards builds the deck: the project's active estimate scale if configured,
// otherwise a Fibonacci deck; plus the "?" and break cards.
func (s *PokerService) cards(ctx context.Context, slug string, projectID, userID uuid.UUID) []PokerCard {
	var out []PokerCard
	if list, err := s.estimate.ListByProject(ctx, slug, projectID, userID); err == nil && len(list) > 0 {
		active := list[0]
		for _, e := range list {
			if e.LastUsed {
				active = e
				break
			}
		}
		seen := map[string]bool{}
		for _, p := range active.Points {
			v := strings.TrimSpace(p.Value)
			if v == "" || seen[v] {
				continue
			}
			seen[v] = true
			id := p.ID
			out = append(out, PokerCard{Value: v, EstimatePointID: &id})
		}
	}
	if len(out) == 0 {
		for _, v := range defaultPokerDeck {
			out = append(out, PokerCard{Value: v})
		}
	}
	return append(out, PokerCard{Value: pokerUnsure, Special: true}, PokerCard{Value: pokerBreak, Special: true})
}

func cardFor(cards []PokerCard, v string) (PokerCard, bool) {
	for _, c := range cards {
		if c.Value == v {
			return c, true
		}
	}
	return PokerCard{}, false
}

// audience = project members (+ the actor), used for realtime pushes and notifications.
func (s *PokerService) audience(ctx context.Context, projectID uuid.UUID, extra ...uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	var out []uuid.UUID
	add := func(id uuid.UUID) {
		if id != uuid.Nil && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	if ms, err := s.projects.ListMembers(ctx, projectID); err == nil {
		for _, m := range ms {
			if m.MemberID != nil {
				add(*m.MemberID)
			}
		}
	}
	for _, id := range extra {
		add(id)
	}
	return out
}

func (s *PokerService) push(ctx context.Context, issue *model.Issue, extra ...uuid.UUID) {
	if s.hub == nil {
		return
	}
	iid := issue.ID
	for _, id := range s.audience(ctx, issue.ProjectID, extra...) {
		s.hub.Publish(id, realtime.Event{Type: "poker", WorkspaceID: issue.WorkspaceID, IssueID: &iid})
	}
}

func (s *PokerService) canManage(ctx context.Context, issue *model.Issue, round *model.PokerRound, userID uuid.UUID) bool {
	if round != nil && round.StartedByID == userID {
		return true
	}
	m, err := s.ws.GetMember(ctx, issue.WorkspaceID, userID)
	return err == nil && m.Role >= model.RoleAdmin
}

// State returns the current poker state (votes stay hidden until reveal).
func (s *PokerService) State(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*PokerState, error) {
	issue, err := s.issues.GetByID(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	return s.build(ctx, slug, issue, userID)
}

func (s *PokerService) build(ctx context.Context, slug string, issue *model.Issue, userID uuid.UUID) (*PokerState, error) {
	round, err := s.ps.Current(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	st := &PokerState{Round: round, Cards: s.cards(ctx, slug, issue.ProjectID, userID), Participants: []PokerParticipant{}}
	if st.History, err = s.ps.History(ctx, issue.ID, 10); err != nil {
		return nil, err
	}
	if st.History == nil {
		st.History = []model.PokerRound{}
	}
	st.CanManage = s.canManage(ctx, issue, round, userID)
	if round == nil {
		return st, nil
	}
	votes, err := s.ps.Votes(ctx, round.ID)
	if err != nil {
		return nil, err
	}
	byUser := map[uuid.UUID]string{}
	for _, v := range votes {
		byUser[v.UserID] = v.Value
	}
	if v, ok := byUser[userID]; ok {
		st.MyVote = &v
	}
	revealed := round.Status != model.PokerVoting
	ids := s.audience(ctx, issue.ProjectID)
	for id := range byUser { // include voters who aren't (or are no longer) listed project members
		found := false
		for _, x := range ids {
			if x == id {
				found = true
				break
			}
		}
		if !found {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		v, voted := byUser[id]
		p := PokerParticipant{UserID: id, Voted: voted}
		if voted && revealed {
			val := v
			p.Value = &val
		}
		st.Participants = append(st.Participants, p)
	}
	if revealed {
		st.Stats = pokerStats(votes)
	}
	return st, nil
}

func pokerStats(votes []model.PokerVote) *PokerStats {
	stats := &PokerStats{}
	var nums []float64
	counts := map[string]int{}
	for _, v := range votes {
		counts[v.Value]++
		if f, err := strconv.ParseFloat(v.Value, 64); err == nil {
			nums = append(nums, f)
		}
	}
	stats.NumericVotes = len(nums)
	if len(nums) > 0 {
		sort.Float64s(nums)
		sum := 0.0
		for _, f := range nums {
			sum += f
		}
		avg := sum / float64(len(nums))
		mn, mx := nums[0], nums[len(nums)-1]
		stats.Average, stats.Min, stats.Max = &avg, &mn, &mx
	}
	// Suggested = most voted real (non-special) card; ties go to the higher estimate.
	best, bestN, bestF := "", 0, -1.0
	for v, n := range counts {
		if v == pokerUnsure || v == pokerBreak {
			continue
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			f = 0
		}
		if n > bestN || (n == bestN && f > bestF) {
			best, bestN, bestF = v, n, f
		}
	}
	if best != "" {
		stats.Suggested = &best
	}
	stats.Consensus = len(counts) == 1 && len(votes) > 1
	return stats
}

// Start opens a round (idempotent while one is in progress) and asks the project to vote.
func (s *PokerService) Start(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*PokerState, error) {
	issue, err := s.issues.GetByID(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	cur, err := s.ps.Current(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if cur == nil || cur.Status == model.PokerFinalized {
		r := &model.PokerRound{WorkspaceID: issue.WorkspaceID, ProjectID: issue.ProjectID, IssueID: issue.ID, Status: model.PokerVoting, StartedByID: userID}
		if err := s.ps.CreateRound(ctx, r); err != nil {
			return nil, err
		}
		s.push(ctx, issue, userID)
		if s.notify != nil {
			s.notify.IssuePokerStarted(ctx, issue, userID, s.audience(ctx, issue.ProjectID))
		}
	}
	return s.build(ctx, slug, issue, userID)
}

// Vote records (or replaces) the caller's card while voting is open.
func (s *PokerService) Vote(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID, value string) (*PokerState, error) {
	issue, err := s.issues.GetByID(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	round, err := s.ps.Current(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if round == nil {
		return nil, ErrPokerNoRound
	}
	if round.Status != model.PokerVoting {
		return nil, ErrPokerState
	}
	if _, ok := cardFor(s.cards(ctx, slug, projectID, userID), value); !ok {
		return nil, ErrPokerBadCard
	}
	if err := s.ps.UpsertVote(ctx, round.ID, userID, value); err != nil {
		return nil, err
	}
	s.push(ctx, issue, userID)
	return s.build(ctx, slug, issue, userID)
}

// Retract removes the caller's vote while voting is open.
func (s *PokerService) Retract(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*PokerState, error) {
	issue, err := s.issues.GetByID(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	round, err := s.ps.Current(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if round == nil || round.Status != model.PokerVoting {
		return nil, ErrPokerState
	}
	if err := s.ps.DeleteVote(ctx, round.ID, userID); err != nil {
		return nil, err
	}
	s.push(ctx, issue, userID)
	return s.build(ctx, slug, issue, userID)
}

func (s *PokerService) managedRound(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*model.Issue, *model.PokerRound, error) {
	issue, err := s.issues.GetByID(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, nil, err
	}
	round, err := s.ps.Current(ctx, issue.ID)
	if err != nil {
		return nil, nil, err
	}
	if round == nil {
		return nil, nil, ErrPokerNoRound
	}
	if !s.canManage(ctx, issue, round, userID) {
		return nil, nil, ErrPokerForbidden
	}
	return issue, round, nil
}

// Reveal flips all cards face up.
func (s *PokerService) Reveal(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*PokerState, error) {
	issue, round, err := s.managedRound(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	if round.Status != model.PokerVoting {
		return nil, ErrPokerState
	}
	now := time.Now().UTC()
	round.Status, round.RevealedAt = model.PokerRevealed, &now
	if err := s.ps.SaveRound(ctx, round); err != nil {
		return nil, err
	}
	s.push(ctx, issue, userID)
	return s.build(ctx, slug, issue, userID)
}

// Restart discards the in-progress round and opens a fresh one (re-vote).
func (s *PokerService) Restart(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID) (*PokerState, error) {
	issue, round, err := s.managedRound(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	if round.Status == model.PokerFinalized {
		return nil, ErrPokerState
	}
	round.Status = model.PokerDiscarded
	if err := s.ps.SaveRound(ctx, round); err != nil {
		return nil, err
	}
	nr := &model.PokerRound{WorkspaceID: issue.WorkspaceID, ProjectID: issue.ProjectID, IssueID: issue.ID, Status: model.PokerVoting, StartedByID: userID}
	if err := s.ps.CreateRound(ctx, nr); err != nil {
		return nil, err
	}
	s.push(ctx, issue, userID)
	return s.build(ctx, slug, issue, userID)
}

// Finalize records the agreed estimate and, when the card maps to the project's
// estimate scale, sets it on the work item.
func (s *PokerService) Finalize(ctx context.Context, slug string, projectID, issueID, userID uuid.UUID, value string) (*PokerState, error) {
	issue, round, err := s.managedRound(ctx, slug, projectID, issueID, userID)
	if err != nil {
		return nil, err
	}
	if round.Status != model.PokerRevealed {
		return nil, ErrPokerState
	}
	card, ok := cardFor(s.cards(ctx, slug, projectID, userID), value)
	if !ok || card.Special {
		return nil, ErrPokerBadCard
	}
	if card.EstimatePointID != nil {
		pid := *card.EstimatePointID
		if _, err := s.issues.Update(ctx, slug, projectID, issueID, userID,
			nil, nil, nil, nil, nil, nil, false, nil, false, nil, nil, nil, nil, true, &pid, nil); err != nil {
			return nil, err
		}
		round.FinalEstimatePointID = &pid
	}
	now := time.Now().UTC()
	round.Status, round.FinalValue, round.FinalizedAt = model.PokerFinalized, &value, &now
	if err := s.ps.SaveRound(ctx, round); err != nil {
		return nil, err
	}
	s.push(ctx, issue, userID)
	return s.build(ctx, slug, issue, userID)
}

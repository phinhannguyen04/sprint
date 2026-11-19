package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/Devlaner/devlane/api/internal/model"
	"github.com/Devlaner/devlane/api/internal/realtime"
	"github.com/Devlaner/devlane/api/internal/store"
	"github.com/google/uuid"
)

var (
	ErrChatForbidden    = errors.New("not a member of this workspace")
	ErrChatEmptyMessage = errors.New("message is empty")
	ErrChatTooLong      = errors.New("message is too long")
	ErrChatSelf         = errors.New("cannot message yourself")
)

const maxChatBodyLen = 4000

// ChatService implements 1:1 chat between members of the same workspace.
type ChatService struct {
	dm  *store.DirectMessageStore
	ws  *store.WorkspaceStore
	hub *realtime.Hub
}

// SetHub wires realtime push for new messages. Optional.
func (s *ChatService) SetHub(h *realtime.Hub) { s.hub = h }

func NewChatService(dm *store.DirectMessageStore, ws *store.WorkspaceStore) *ChatService {
	return &ChatService{dm: dm, ws: ws}
}

// Conversation is one inbox chat row.
type Conversation struct {
	PeerID      uuid.UUID            `json:"peer_id"`
	LastMessage *model.DirectMessage `json:"last_message,omitempty"`
	Unread      int64                `json:"unread"`
}

func (s *ChatService) workspaceFor(ctx context.Context, slug string, userID uuid.UUID) (*model.Workspace, error) {
	w, err := s.ws.GetBySlug(ctx, slug)
	if err != nil {
		return nil, ErrChatForbidden
	}
	ok, _ := s.ws.IsMember(ctx, w.ID, userID)
	if !ok {
		return nil, ErrChatForbidden
	}
	return w, nil
}

// Conversations lists existing conversations (newest first) plus every other
// workspace member without one yet, so the UI can start a new chat.
func (s *ChatService) Conversations(ctx context.Context, slug string, userID uuid.UUID) ([]Conversation, error) {
	w, err := s.workspaceFor(ctx, slug, userID)
	if err != nil {
		return nil, err
	}
	sums, err := s.dm.ListConversations(ctx, w.ID, userID)
	if err != nil {
		return nil, err
	}
	sort.Slice(sums, func(i, j int) bool { return sums[i].LastMessage.CreatedAt.After(sums[j].LastMessage.CreatedAt) })
	seen := map[uuid.UUID]bool{}
	out := make([]Conversation, 0, len(sums))
	for i := range sums {
		seen[sums[i].PeerID] = true
		out = append(out, Conversation{PeerID: sums[i].PeerID, LastMessage: &sums[i].LastMessage, Unread: sums[i].Unread})
	}
	members, err := s.ws.ListMembers(ctx, w.ID)
	if err != nil {
		return nil, err
	}
	for _, m := range members {
		if m.MemberID == userID || seen[m.MemberID] {
			continue
		}
		seen[m.MemberID] = true
		out = append(out, Conversation{PeerID: m.MemberID})
	}
	return out, nil
}

// Messages returns the thread with peer and marks incoming messages read.
func (s *ChatService) Messages(ctx context.Context, slug string, userID, peerID uuid.UUID, after *time.Time) ([]model.DirectMessage, error) {
	w, err := s.workspaceFor(ctx, slug, userID)
	if err != nil {
		return nil, err
	}
	if ok, _ := s.ws.IsMember(ctx, w.ID, peerID); !ok {
		return nil, ErrChatForbidden
	}
	msgs, err := s.dm.ListBetween(ctx, w.ID, userID, peerID, after, 200)
	if err != nil {
		return nil, err
	}
	_ = s.dm.MarkThreadRead(ctx, w.ID, userID, peerID)
	return msgs, nil
}

// Send stores a message from userID to peerID.
func (s *ChatService) Send(ctx context.Context, slug string, userID, peerID uuid.UUID, body string) (*model.DirectMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, ErrChatEmptyMessage
	}
	if len(body) > maxChatBodyLen {
		return nil, ErrChatTooLong
	}
	if userID == peerID {
		return nil, ErrChatSelf
	}
	w, err := s.workspaceFor(ctx, slug, userID)
	if err != nil {
		return nil, err
	}
	if ok, _ := s.ws.IsMember(ctx, w.ID, peerID); !ok {
		return nil, ErrChatForbidden
	}
	m := &model.DirectMessage{WorkspaceID: w.ID, SenderID: userID, ReceiverID: peerID, Body: body}
	if err := s.dm.Create(ctx, m); err != nil {
		return nil, err
	}
	// Push to the receiver, and to the sender's other tabs/devices.
	s.hub.Publish(peerID, realtime.Event{Type: "chat", WorkspaceID: w.ID, PeerID: &userID})
	s.hub.Publish(userID, realtime.Event{Type: "chat", WorkspaceID: w.ID, PeerID: &peerID})
	return m, nil
}

// UnreadCount returns total unread chat messages for the user in the workspace.
func (s *ChatService) UnreadCount(ctx context.Context, slug string, userID uuid.UUID) (int64, error) {
	w, err := s.workspaceFor(ctx, slug, userID)
	if err != nil {
		return 0, err
	}
	return s.dm.CountUnread(ctx, w.ID, userID)
}

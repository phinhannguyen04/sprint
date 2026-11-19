package store

import (
	"context"
	"time"

	"github.com/Devlaner/devlane/api/internal/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PokerStore persists planning-poker rounds and votes.
type PokerStore struct{ db *gorm.DB }

func NewPokerStore(db *gorm.DB) *PokerStore { return &PokerStore{db: db} }

// Current returns the newest non-discarded round for the issue, or (nil, nil).
func (s *PokerStore) Current(ctx context.Context, issueID uuid.UUID) (*model.PokerRound, error) {
	var r model.PokerRound
	err := s.db.WithContext(ctx).
		Where("issue_id = ? AND status <> ?", issueID, model.PokerDiscarded).
		Order("created_at DESC").Limit(1).First(&r).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *PokerStore) GetRound(ctx context.Context, id uuid.UUID) (*model.PokerRound, error) {
	var r model.PokerRound
	if err := s.db.WithContext(ctx).First(&r, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *PokerStore) CreateRound(ctx context.Context, r *model.PokerRound) error {
	return s.db.WithContext(ctx).Create(r).Error
}

func (s *PokerStore) SaveRound(ctx context.Context, r *model.PokerRound) error {
	return s.db.WithContext(ctx).Save(r).Error
}

// History returns finalized rounds (newest first).
func (s *PokerStore) History(ctx context.Context, issueID uuid.UUID, limit int) ([]model.PokerRound, error) {
	var out []model.PokerRound
	err := s.db.WithContext(ctx).
		Where("issue_id = ? AND status = ?", issueID, model.PokerFinalized).
		Order("finalized_at DESC").Limit(limit).Find(&out).Error
	return out, err
}

// UpsertVote sets the user's card for the round (replacing any earlier one).
func (s *PokerStore) UpsertVote(ctx context.Context, roundID, userID uuid.UUID, value string) error {
	v := model.PokerVote{RoundID: roundID, UserID: userID, Value: value}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "round_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{"value": value, "updated_at": time.Now().UTC()}),
	}).Create(&v).Error
}

func (s *PokerStore) DeleteVote(ctx context.Context, roundID, userID uuid.UUID) error {
	return s.db.WithContext(ctx).Where("round_id = ? AND user_id = ?", roundID, userID).Delete(&model.PokerVote{}).Error
}

func (s *PokerStore) Votes(ctx context.Context, roundID uuid.UUID) ([]model.PokerVote, error) {
	var out []model.PokerVote
	err := s.db.WithContext(ctx).Where("round_id = ?", roundID).Find(&out).Error
	return out, err
}

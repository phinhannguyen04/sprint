package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Poker round statuses.
const (
	PokerVoting    = "voting"
	PokerRevealed  = "revealed"
	PokerFinalized = "finalized"
	PokerDiscarded = "discarded"
)

// PokerRound is one planning-poker estimation round for a work item.
type PokerRound struct {
	ID                   uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	WorkspaceID          uuid.UUID  `gorm:"type:uuid;not null" json:"workspace_id"`
	ProjectID            uuid.UUID  `gorm:"type:uuid;not null" json:"project_id"`
	IssueID              uuid.UUID  `gorm:"type:uuid;not null" json:"issue_id"`
	Status               string     `gorm:"type:varchar(16);not null;default:voting" json:"status"`
	StartedByID          uuid.UUID  `gorm:"type:uuid;not null" json:"started_by_id"`
	FinalValue           *string    `gorm:"type:varchar(32)" json:"final_value,omitempty"`
	FinalEstimatePointID *uuid.UUID `gorm:"type:uuid" json:"final_estimate_point_id,omitempty"`
	RevealedAt           *time.Time `gorm:"type:timestamptz" json:"revealed_at,omitempty"`
	FinalizedAt          *time.Time `gorm:"type:timestamptz" json:"finalized_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

func (PokerRound) TableName() string { return "poker_rounds" }

func (r *PokerRound) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// PokerVote is one member's (private until reveal) card in a round.
type PokerVote struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RoundID   uuid.UUID `gorm:"type:uuid;not null" json:"round_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Value     string    `gorm:"type:varchar(32);not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PokerVote) TableName() string { return "poker_votes" }

func (v *PokerVote) BeforeCreate(tx *gorm.DB) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	return nil
}

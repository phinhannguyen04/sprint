package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DirectMessage matches direct_messages: a 1:1 chat message between two
// members of the same workspace.
type DirectMessage struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	WorkspaceID uuid.UUID  `gorm:"type:uuid;not null" json:"workspace_id"`
	SenderID    uuid.UUID  `gorm:"type:uuid;not null" json:"sender_id"`
	ReceiverID  uuid.UUID  `gorm:"type:uuid;not null" json:"receiver_id"`
	Body        string     `gorm:"type:text;not null" json:"body"`
	ReadAt      *time.Time `gorm:"type:timestamptz" json:"read_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (DirectMessage) TableName() string { return "direct_messages" }

func (m *DirectMessage) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

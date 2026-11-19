package store

import (
	"context"
	"time"

	"github.com/Devlaner/devlane/api/internal/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DirectMessageStore handles 1:1 chat message persistence.
type DirectMessageStore struct{ db *gorm.DB }

func NewDirectMessageStore(db *gorm.DB) *DirectMessageStore { return &DirectMessageStore{db: db} }

// ConversationSummary is the latest message with a peer plus the unread count.
type ConversationSummary struct {
	PeerID      uuid.UUID
	LastMessage model.DirectMessage
	Unread      int64
}

func (s *DirectMessageStore) Create(ctx context.Context, m *model.DirectMessage) error {
	return s.db.WithContext(ctx).Create(m).Error
}

// ListBetween returns the thread between a and b (oldest first). When after is
// non-nil only messages created after that instant are returned (for polling).
func (s *DirectMessageStore) ListBetween(ctx context.Context, workspaceID, a, b uuid.UUID, after *time.Time, limit int) ([]model.DirectMessage, error) {
	q := s.db.WithContext(ctx).Where(
		"workspace_id = ? AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))",
		workspaceID, a, b, b, a)
	if after != nil {
		q = q.Where("created_at > ?", *after)
	}
	var out []model.DirectMessage
	// Newest `limit` rows, then flip to chronological order.
	if err := q.Order("created_at DESC").Limit(limit).Find(&out).Error; err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// MarkThreadRead marks messages sent by peer to me as read.
func (s *DirectMessageStore) MarkThreadRead(ctx context.Context, workspaceID, me, peer uuid.UUID) error {
	return s.db.WithContext(ctx).Model(&model.DirectMessage{}).
		Where("workspace_id = ? AND receiver_id = ? AND sender_id = ? AND read_at IS NULL", workspaceID, me, peer).
		Update("read_at", time.Now().UTC()).Error
}

// CountUnread returns the total unread direct messages for me in the workspace.
func (s *DirectMessageStore) CountUnread(ctx context.Context, workspaceID, me uuid.UUID) (int64, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.DirectMessage{}).
		Where("workspace_id = ? AND receiver_id = ? AND read_at IS NULL", workspaceID, me).
		Count(&n).Error
	return n, err
}

// ListConversations returns one summary per peer I have exchanged messages with.
func (s *DirectMessageStore) ListConversations(ctx context.Context, workspaceID, me uuid.UUID) ([]ConversationSummary, error) {
	var msgs []model.DirectMessage
	// DISTINCT ON picks the newest message for each peer.
	err := s.db.WithContext(ctx).Raw(`
		SELECT DISTINCT ON (peer) m.*
		FROM (
			SELECT dm.*, CASE WHEN dm.sender_id = ? THEN dm.receiver_id ELSE dm.sender_id END AS peer
			FROM direct_messages dm
			WHERE dm.workspace_id = ? AND (dm.sender_id = ? OR dm.receiver_id = ?)
		) m
		ORDER BY peer, m.created_at DESC`, me, workspaceID, me, me).Scan(&msgs).Error
	if err != nil {
		return nil, err
	}
	type unreadRow struct {
		SenderID uuid.UUID
		N        int64
	}
	var rows []unreadRow
	if err := s.db.WithContext(ctx).Model(&model.DirectMessage{}).
		Select("sender_id, COUNT(*) AS n").
		Where("workspace_id = ? AND receiver_id = ? AND read_at IS NULL", workspaceID, me).
		Group("sender_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	unread := make(map[uuid.UUID]int64, len(rows))
	for _, r := range rows {
		unread[r.SenderID] = r.N
	}
	out := make([]ConversationSummary, 0, len(msgs))
	for _, m := range msgs {
		peer := m.SenderID
		if peer == me {
			peer = m.ReceiverID
		}
		out = append(out, ConversationSummary{PeerID: peer, LastMessage: m, Unread: unread[peer]})
	}
	return out, nil
}

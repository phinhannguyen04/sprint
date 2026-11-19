// Package realtime is a small in-process pub/sub used to push inbox events
// (new notifications, chat messages) to connected browsers over SSE.
//
// It is per-process: with several API replicas, publish through Redis instead.
package realtime

import (
	"sync"

	"github.com/google/uuid"
)

// Event is pushed to a user's open streams. Type is "notification", "chat" or "poker".
type Event struct {
	Type        string    `json:"type"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	// PeerID is the other chat participant (chat events only).
	PeerID *uuid.UUID `json:"peer_id,omitempty"`
	// IssueID is set for "poker" events (planning poker state changed).
	IssueID *uuid.UUID `json:"issue_id,omitempty"`
}

// Hub fans events out to every active subscription of a user.
type Hub struct {
	mu   sync.RWMutex
	subs map[uuid.UUID]map[chan Event]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[uuid.UUID]map[chan Event]struct{}{}} }

// Subscribe registers a stream for the user; call the returned func to unsubscribe.
func (h *Hub) Subscribe(userID uuid.UUID) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	if h.subs[userID] == nil {
		h.subs[userID] = map[chan Event]struct{}{}
	}
	h.subs[userID][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[userID], ch)
		if len(h.subs[userID]) == 0 {
			delete(h.subs, userID)
		}
		h.mu.Unlock()
	}
}

// Publish delivers e to the user's streams. Never blocks: a slow client just
// misses the hint (clients also refresh on reconnect and on a slow fallback poll).
func (h *Hub) Publish(userID uuid.UUID, e Event) {
	if h == nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[userID] {
		select {
		case ch <- e:
		default:
		}
	}
}

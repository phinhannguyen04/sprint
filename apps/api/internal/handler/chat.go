package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/Devlaner/devlane/api/internal/middleware"
	"github.com/Devlaner/devlane/api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ChatHandler serves 1:1 workspace chat (shown in the Inbox).
type ChatHandler struct {
	Chat *service.ChatService
}

func chatError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, service.ErrChatForbidden):
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
	case errors.Is(err, service.ErrChatEmptyMessage), errors.Is(err, service.ErrChatTooLong), errors.Is(err, service.ErrChatSelf):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
	}
}

// Conversations: GET /api/workspaces/:slug/chat/conversations/
func (h *ChatHandler) Conversations(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	list, err := h.Chat.Conversations(c.Request.Context(), c.Param("slug"), user.ID)
	if err != nil {
		chatError(c, err, "Failed to list conversations")
		return
	}
	c.JSON(http.StatusOK, list)
}

// Messages: GET /api/workspaces/:slug/chat/:userId/messages/?after=<RFC3339Nano>
func (h *ChatHandler) Messages(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	peerID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user id"})
		return
	}
	var after *time.Time
	if a := c.Query("after"); a != "" {
		t, perr := time.Parse(time.RFC3339Nano, a)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid after"})
			return
		}
		after = &t
	}
	msgs, err := h.Chat.Messages(c.Request.Context(), c.Param("slug"), user.ID, peerID, after)
	if err != nil {
		chatError(c, err, "Failed to load messages")
		return
	}
	c.JSON(http.StatusOK, msgs)
}

// Send: POST /api/workspaces/:slug/chat/:userId/messages/
func (h *ChatHandler) Send(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	peerID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user id"})
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	m, err := h.Chat.Send(c.Request.Context(), c.Param("slug"), user.ID, peerID, body.Body)
	if err != nil {
		chatError(c, err, "Failed to send message")
		return
	}
	c.JSON(http.StatusCreated, m)
}

// UnreadCount: GET /api/workspaces/:slug/chat/unread-count/
func (h *ChatHandler) UnreadCount(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	n, err := h.Chat.UnreadCount(c.Request.Context(), c.Param("slug"), user.ID)
	if err != nil {
		chatError(c, err, "Failed to count messages")
		return
	}
	c.JSON(http.StatusOK, gin.H{"total": n})
}

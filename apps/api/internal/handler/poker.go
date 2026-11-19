package handler

import (
	"errors"
	"net/http"

	"github.com/Devlaner/devlane/api/internal/middleware"
	"github.com/Devlaner/devlane/api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// PokerHandler serves planning poker for a work item.
type PokerHandler struct {
	Poker *service.PokerService
}

func (h *PokerHandler) ctx(c *gin.Context) (slug string, projectID, issueID, userID uuid.UUID, ok bool) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	var err error
	if projectID, err = uuid.Parse(c.Param("projectId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project id"})
		return
	}
	if issueID, err = uuid.Parse(c.Param("pk")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid issue id"})
		return
	}
	return c.Param("slug"), projectID, issueID, user.ID, true
}

func pokerRespond(c *gin.Context, st *service.PokerState, err error, status int) {
	switch {
	case err == nil:
		c.JSON(status, st)
	case errors.Is(err, service.ErrProjectForbidden), errors.Is(err, service.ErrProjectNotFound), errors.Is(err, service.ErrIssueNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
	case errors.Is(err, service.ErrPokerForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrPokerBadCard), errors.Is(err, service.ErrPokerNoRound):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrPokerState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Planning poker request failed"})
	}
}

// GET  .../issues/:pk/poker/
func (h *PokerHandler) State(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	st, err := h.Poker.State(c.Request.Context(), slug, p, i, u)
	pokerRespond(c, st, err, http.StatusOK)
}

// POST .../issues/:pk/poker/start/
func (h *PokerHandler) Start(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	st, err := h.Poker.Start(c.Request.Context(), slug, p, i, u)
	pokerRespond(c, st, err, http.StatusOK)
}

// PUT  .../issues/:pk/poker/vote/   {"value":"5"}
func (h *PokerHandler) Vote(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	var body struct {
		Value string `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	st, err := h.Poker.Vote(c.Request.Context(), slug, p, i, u, body.Value)
	pokerRespond(c, st, err, http.StatusOK)
}

// DELETE .../issues/:pk/poker/vote/
func (h *PokerHandler) Retract(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	st, err := h.Poker.Retract(c.Request.Context(), slug, p, i, u)
	pokerRespond(c, st, err, http.StatusOK)
}

// POST .../issues/:pk/poker/reveal/
func (h *PokerHandler) Reveal(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	st, err := h.Poker.Reveal(c.Request.Context(), slug, p, i, u)
	pokerRespond(c, st, err, http.StatusOK)
}

// POST .../issues/:pk/poker/restart/
func (h *PokerHandler) Restart(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	st, err := h.Poker.Restart(c.Request.Context(), slug, p, i, u)
	pokerRespond(c, st, err, http.StatusOK)
}

// POST .../issues/:pk/poker/finalize/   {"value":"5"}
func (h *PokerHandler) Finalize(c *gin.Context) {
	slug, p, i, u, ok := h.ctx(c)
	if !ok {
		return
	}
	var body struct {
		Value string `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	st, err := h.Poker.Finalize(c.Request.Context(), slug, p, i, u, body.Value)
	pokerRespond(c, st, err, http.StatusOK)
}

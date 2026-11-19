package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Devlaner/devlane/api/internal/auth"
	"github.com/Devlaner/devlane/api/internal/model"
	"github.com/Devlaner/devlane/api/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// AdminUserHandler lets instance admins provision accounts. Sign-up, OAuth and
// magic-code login are disabled, so this is the only way new users appear.
type AdminUserHandler struct {
	Settings *InstanceSettingsHandler // reuses the instance-admin gate
	Auth     *auth.Service
	Users    *store.UserStore
	Ws       *store.WorkspaceStore
}

type createUserRequest struct {
	Email         string `json:"email" binding:"required,email"`
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	WorkspaceSlug string `json:"workspace_slug"`
	Role          *int16 `json:"role"`
}

// CreateUser creates an account with a random password and returns it ONCE.
// POST /api/instance/users/
func (h *AdminUserHandler) CreateUser(c *gin.Context) {
	if !h.Settings.requireInstanceAdmin(c) {
		return
	}
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request", "detail": err.Error()})
		return
	}
	role := model.RoleMember
	if req.Role != nil {
		if !model.IsValidRole(*req.Role) || *req.Role == model.RoleOwner {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
			return
		}
		role = *req.Role
	}
	ctx := c.Request.Context()
	var ws *model.Workspace
	if slug := strings.TrimSpace(req.WorkspaceSlug); slug != "" {
		w, err := h.Ws.GetBySlug(ctx, slug)
		if err != nil || w == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found"})
			return
		}
		ws = w
	}
	password, err := auth.GeneratePassword()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate password"})
		return
	}
	user, err := h.Auth.AdminCreateUser(ctx, req.Email, strings.TrimSpace(req.FirstName), strings.TrimSpace(req.LastName), password)
	if err != nil {
		if errors.Is(err, auth.ErrEmailTaken) {
			c.JSON(http.StatusConflict, gin.H{"error": "Email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}
	if ws != nil {
		if err := h.Ws.AddMember(ctx, &model.WorkspaceMember{WorkspaceID: ws.ID, MemberID: user.ID, Role: role}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "User created but adding to workspace failed", "user_id": user.ID})
			return
		}
	}
	c.JSON(http.StatusCreated, gin.H{"user": userResponse(user), "password": password})
}

// ResetUserPassword issues a new random password for a user and revokes their sessions.
// POST /api/instance/users/:id/reset-password/
func (h *AdminUserHandler) ResetUserPassword(c *gin.Context) {
	if !h.Settings.requireInstanceAdmin(c) {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user id"})
		return
	}
	ctx := c.Request.Context()
	user, err := h.Users.GetByID(ctx, id)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	password, err := auth.GeneratePassword()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate password"})
		return
	}
	if err := h.Auth.AdminResetPassword(ctx, id, password); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset password"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": userResponse(user), "password": password})
}

package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Devlaner/devlane/api/internal/middleware"
	"github.com/Devlaner/devlane/api/internal/realtime"
	"github.com/gin-gonic/gin"
)

// EventsHandler streams realtime inbox events to the signed-in user (SSE).
type EventsHandler struct {
	Hub *realtime.Hub
}

// Stream: GET /api/events/
func (h *EventsHandler) Stream(c *gin.Context) {
	user := middleware.GetUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	rc := http.NewResponseController(c.Writer)
	hdr := c.Writer.Header()
	hdr.Set("Content-Type", "text/event-stream")
	hdr.Set("Cache-Control", "no-cache")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no") // disable proxy buffering

	events, unsubscribe := h.Hub.Subscribe(user.ID)
	defer unsubscribe()

	// The server has a short WriteTimeout for normal requests; extend it per write.
	write := func(s string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(30 * time.Second))
		if _, err := fmt.Fprint(c.Writer, s); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !write("retry: 3000\n: connected\n\n") {
		return
	}

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case e := <-events:
			b, _ := json.Marshal(e)
			if !write("event: " + e.Type + "\ndata: " + string(b) + "\n\n") {
				return
			}
		case <-heartbeat.C:
			if !write(": ping\n\n") {
				return
			}
		}
	}
}

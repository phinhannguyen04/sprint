-- Direct (1:1) chat messages between members of the same workspace.
CREATE TABLE IF NOT EXISTS direct_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    sender_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    receiver_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_pair
    ON direct_messages (workspace_id, sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_receiver_unread
    ON direct_messages (workspace_id, receiver_id) WHERE read_at IS NULL;

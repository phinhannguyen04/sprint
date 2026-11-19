-- Backlog refinement planning poker: one row per estimation round of a work item.
CREATE TABLE IF NOT EXISTS poker_rounds (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id            UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    issue_id                UUID NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    -- voting -> revealed -> finalized; discarded = restarted before finishing
    status                  VARCHAR(16) NOT NULL DEFAULT 'voting',
    started_by_id           UUID NOT NULL,
    final_value             VARCHAR(32),
    final_estimate_point_id UUID,
    revealed_at             TIMESTAMPTZ,
    finalized_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poker_rounds_issue ON poker_rounds (issue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS poker_votes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id   UUID NOT NULL REFERENCES poker_rounds (id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    value      VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (round_id, user_id)
);

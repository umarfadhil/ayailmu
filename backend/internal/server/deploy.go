package server

import (
	"context"
	"fmt"

	"ayailmu.local/backend/internal/authn"
)

// denyAll is ModeDeploySmoke's verifier. It trusts no identity provider and contacts nothing: every token, well-formed
// or not, is refused, so every route but health and readiness answers the uniform 401, and no account is ever created
// or deleted.
type denyAll struct{}

var _ accountVerifier = denyAll{}

func (denyAll) Verify(context.Context, string) (authn.Identity, error) {
	return authn.Identity{}, fmt.Errorf("%w: deploy-smoke trusts no identity provider", authn.ErrUnauthenticated)
}

func (denyAll) VerifySession(context.Context, string) (authn.Session, error) {
	return authn.Session{}, fmt.Errorf("%w: deploy-smoke trusts no identity provider", authn.ErrUnauthenticated)
}

func (denyAll) DeleteIdentity(context.Context, authn.Identity) error {
	return fmt.Errorf("%w: deploy-smoke trusts no identity provider", authn.ErrIdentityNotDeleted)
}

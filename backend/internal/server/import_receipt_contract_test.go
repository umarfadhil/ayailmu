package server_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/server"
)

// Receipt contract regressions for POST /v1/imports (contract §5). Neither test uses the event routes.

// A repeated event is stored once, but the receipt checksum covers the event IDs exactly as the request
// carried them, repeats included.
func TestImportReceiptChecksumKeepsInputMultiplicity(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-m-1", LocalProfileID: "lrn-m-1"}
	ev := answer{id: "ans-m-1", learner: src.LocalProfileID, install: src.InstallID}.envelope()

	r := s.call(t, http.MethodPost, "/v1/imports", u.token, importBody("imp-m-1", src, newAdult, ev, ev))
	wantStatus(t, r, http.StatusCreated)
	var rc receipt
	decodeJSON(t, r.body, &rc)
	if rc.ImportID != "imp-m-1" || !uuidRE.MatchString(rc.ProfileID) || !rc.ProfileCreated || rc.Replayed ||
		rc.Stored != 1 || rc.Identical != 1 || rc.HighSeq != 1 {
		t.Fatalf("receipt = %+v, want a new profile holding the event once and its repeat counted identical", rc)
	}
	for _, c := range []struct {
		what      string
		got, want int
	}{
		{"profiles of the account", s.count(t, `SELECT count(*) FROM profiles p JOIN accounts a USING (account_id) WHERE a.subject = $1`, u.uid), 1},
		{"device links of the profile", s.count(t, `SELECT count(*) FROM profile_sources WHERE profile_id = $1::uuid`, rc.ProfileID), 1},
		{"stored events of the profile", s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid`, rc.ProfileID), 1},
		{"import records", s.count(t, `SELECT count(*) FROM imports WHERE import_id = 'imp-m-1'`), 1},
	} {
		if c.got != c.want {
			t.Fatalf("%s = %d, want %d", c.what, c.got, c.want)
		}
	}
	var seq int64
	var payload, importID string
	if err := s.db.QueryRow(context.Background(), `SELECT seq, payload_raw, import_id FROM events WHERE profile_id = $1::uuid AND event_id = 'ans-m-1'`,
		rc.ProfileID).Scan(&seq, &payload, &importID); err != nil {
		t.Fatalf("read the stored event: %v", err)
	}
	if exact := payload == string(payloadOf(t, ev)); seq != 1 || importID != "imp-m-1" || !exact {
		t.Fatalf("stored event: seq %d from import %q, exact payload %v; want seq 1 from imp-m-1, byte for byte", seq, importID, exact)
	}

	if want := eventIDsSHA256("ans-m-1", "ans-m-1"); rc.EventIDsSHA256 != want {
		t.Fatalf("event_ids_sha256 = %s, want %s: the checksum covers every event ID the request carried, repeats included", rc.EventIDsSHA256, want)
	}
}

// Whenever the request can be canonicalized, an import ID reused for different content is refused as
// import_id_reused before the events are checked, even if one of them is invalid. Only a request that
// cannot be canonicalized skips the replay check and reports its events instead.
func TestImportIDConflictPrecedesCanonicalizableEventValidation(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-n-1", LocalProfileID: "lrn-n-1"}
	ev := answer{id: "ans-n-1", learner: src.LocalProfileID, install: src.InstallID}.envelope()
	original := importBody("imp-n-1", src, newAdult, ev)

	r := s.call(t, http.MethodPost, "/v1/imports", u.token, original)
	wantStatus(t, r, http.StatusCreated)
	var first receipt
	decodeJSON(t, r.body, &first)
	if !first.ProfileCreated || first.Stored != 1 || first.HighSeq != 1 {
		t.Fatalf("first receipt = %+v, want a new profile with one stored event", first)
	}

	// The same import ID with changed content: canonical JSON throughout, but the envelope declares an
	// unsupported schema version.
	invalid := swap(t, ev, `"schema_version":2`, `"schema_version":3`)
	var p *envelope.Problem
	if _, err := envelope.Parse(invalid, curriculum.Default()); !errors.As(err, &p) || p.Code != envelope.CodeUnsupportedSchemaVersion {
		t.Fatalf("test setup: the changed envelope must fail as unsupported_schema_version, got %v", err)
	}
	changed := importBody("imp-n-1", src, newAdult, invalid)
	if _, err := envelope.Canonicalize(changed); err != nil {
		t.Fatalf("test setup: the changed request must be canonicalizable: %v", err)
	}
	wantProblem(t, s.call(t, http.MethodPost, "/v1/imports", u.token, changed), http.StatusConflict, "import_id_reused")

	// The first import is kept as it was, and nothing new was written.
	r = s.call(t, http.MethodPost, "/v1/imports", u.token, original)
	wantStatus(t, r, http.StatusOK)
	var again receipt
	decodeJSON(t, r.body, &again)
	replayed := again.Replayed
	again.Replayed = false
	if !replayed || again != first {
		t.Fatalf("retrying the first request = %+v, want its original receipt %+v, replayed", again, first)
	}
	for _, c := range []struct {
		what      string
		got, want int
	}{
		{"profiles of the account", s.count(t, `SELECT count(*) FROM profiles p JOIN accounts a USING (account_id) WHERE a.subject = $1`, u.uid), 1},
		{"import records of the account", s.count(t, `SELECT count(*) FROM imports i JOIN accounts a USING (account_id) WHERE a.subject = $1`, u.uid), 1},
		{"stored events of the profile", s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid`, first.ProfileID), 1},
		{"high_seq of the profile", s.count(t, `SELECT high_seq FROM profiles WHERE profile_id = $1::uuid`, first.ProfileID), 1},
	} {
		if c.got != c.want {
			t.Fatalf("%s = %d, want %d", c.what, c.got, c.want)
		}
	}
	var payload string
	if err := s.db.QueryRow(context.Background(), `SELECT payload_raw FROM events WHERE profile_id = $1::uuid AND event_id = 'ans-n-1'`,
		first.ProfileID).Scan(&payload); err != nil {
		t.Fatalf("read the stored event: %v", err)
	}
	if payload != string(payloadOf(t, ev)) {
		t.Fatal("the stored event no longer holds the first import's exact payload")
	}
}

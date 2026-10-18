package httpapi

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

const (
	// maxImportEvents is the most envelopes one import may carry.
	maxImportEvents = 10000
	// maxIDBytes bounds the source identifiers and the consent version, like envelope source fields.
	maxIDBytes = 128
)

type importRequest struct {
	importID string
	source   store.Source
	target   importTarget
	events   []json.RawMessage
}

// importTarget is either an existing profile ID, resolved by the store so that a malformed ID ends in
// the same 404 as another account's profile, or a new adult profile.
type importTarget struct {
	profileID  string
	newProfile *store.NewProfile
}

// importGuest serves POST /v1/imports (contract §5). After the request checks, a request that can be
// canonicalized has its import ID looked up before any event is checked: a replay returns the stored
// receipt, and a changed request under a used ID is a 409 even when one of its events is invalid. A
// request that cannot be canonicalized cannot match a stored import, so its events report why. One store
// transaction then handles the target, the events and the receipt, all or nothing, and checks the import
// ID again under its lock.
func (h *handler) importGuest(w http.ResponseWriter, r *http.Request, c *call) {
	req, p := parseImport(c.body)
	if p != nil {
		writeProblem(w, p)
		return
	}
	canonical, canonErr := envelope.Canonicalize(c.body)
	var requestSHA256 [32]byte
	if canonErr == nil {
		requestSHA256 = sha256.Sum256(canonical)
		receipt, found, err := h.store.LookupImport(r.Context(), c.accountID, req.importID, requestSHA256)
		switch {
		case errors.Is(err, store.ErrImportIDReused):
			writeImportIDReused(w)
			return
		case err != nil:
			h.internal(w, "look up import", err)
			return
		case found:
			receipt.Replayed = true
			writeJSON(w, http.StatusOK, receipt)
			return
		}
	}
	received := time.Now()
	events := make([]store.PendingEvent, 0, len(req.events))
	var failures []eventResult
	for i, raw := range req.events {
		ev, failure := h.checkEnvelope(i, raw, received)
		if failure == nil && !fromSource(ev.Event.Source, req.source) {
			failure = &eventResult{Index: i, EventID: ev.Event.EventID, Result: resultUnlinked, Status: http.StatusConflict,
				Code: codeSourceNotLinked, Detail: "the event comes from another device profile than the import's source"}
		}
		if failure != nil {
			failures = append(failures, *failure)
			continue
		}
		events = append(events, ev)
	}
	if len(failures) > 0 {
		writeProblem(w, importRejected(failures))
		return
	}
	if canonErr != nil {
		// Every event passed envelope.Parse, which applies the canonicalizer's rules, so this does not
		// happen; refuse rather than store a request whose hash is unknown.
		writeProblem(w, newProblem(http.StatusBadRequest, codeInvalidJSON, "the request body is not valid UTF-8 JSON"))
		return
	}
	res, err := h.store.Import(r.Context(), store.ImportInput{
		AccountID:       c.accountID,
		ImportID:        req.importID,
		RequestSHA256:   requestSHA256,
		Source:          req.source,
		TargetProfileID: req.target.profileID,
		NewProfile:      req.target.newProfile,
		Events:          events,
		BeforeCommit:    h.beforeCommit,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, store.ErrImportIDReused):
		writeImportIDReused(w)
	case errors.Is(err, store.ErrSourceAlreadyLinked):
		writeProblem(w, newProblem(http.StatusConflict, codeSourceAlreadyLinked, "this device profile is already linked to another profile of the account"))
	case err != nil:
		h.internal(w, "import", err)
	case res.Conflicted:
		writeProblem(w, importRejected(conflictResults(res.Outcomes, events)))
	case res.Receipt.Replayed:
		writeJSON(w, http.StatusOK, res.Receipt)
	default:
		writeJSON(w, http.StatusCreated, res.Receipt)
	}
}

func writeImportIDReused(w http.ResponseWriter) {
	writeProblem(w, newProblem(http.StatusConflict, codeImportIDReused, "this import_id was already used for a different request"))
}

func fromSource(s envelope.Source, src store.Source) bool {
	return s.App == src.App && s.InstallID == src.InstallID && s.LocalProfileID == src.LocalProfileID
}

// importRejected reports the events that failed. Nothing was written: 422 when any event is invalid,
// otherwise 409.
func importRejected(failures []eventResult) *problem {
	status := http.StatusConflict
	for _, f := range failures {
		if f.Status == http.StatusUnprocessableEntity {
			status = http.StatusUnprocessableEntity
			break
		}
	}
	p := newProblem(status, codeImportRejected, "the import was refused as a whole and nothing was written; results list the events that failed")
	p.Results = failures
	return p
}

func conflictResults(outcomes []store.EventOutcome, events []store.PendingEvent) []eventResult {
	var out []eventResult
	for i, o := range outcomes {
		if o.Result == store.ResultConflict {
			out = append(out, outcomeResult(i, events[i], o))
		}
	}
	return out
}

// parseImport checks the request outside its events: the wrapper shape (400), strict JSON (400), the
// import ID, the source and the target (422).
func parseImport(body []byte) (importRequest, *problem) {
	shape := invalidRequest(`the body must be {"import_id":"...","source":{...},"target":{...},"events":[...]} with no other member`)
	members, ok := objectMembers(body)
	idRaw, hasID := members["import_id"]
	sourceRaw, hasSource := members["source"]
	targetRaw, hasTarget := members["target"]
	eventsRaw, hasEvents := members["events"]
	if !ok || len(members) != 4 || !hasID || !hasSource || !hasTarget || !hasEvents ||
		!startsWith(idRaw, '"') || !startsWith(sourceRaw, '{') || !startsWith(targetRaw, '{') {
		return importRequest{}, shape
	}
	envs, isArray, tooMany := arrayElements(eventsRaw, maxImportEvents)
	switch {
	case tooMany:
		return importRequest{}, newProblem(http.StatusRequestEntityTooLarge, codeBatchTooLarge, "an import holds at most 10000 events")
	case !isArray:
		return importRequest{}, shape
	}
	for _, raw := range []json.RawMessage{idRaw, sourceRaw, targetRaw} {
		if p := strictJSON(raw); p != nil {
			return importRequest{}, p
		}
	}
	req := importRequest{events: envs}
	req.importID, _ = jsonString(idRaw)
	switch {
	case hasNUL(req.importID):
		return importRequest{}, nulInIndexedText()
	case !isEventID(req.importID):
		return importRequest{}, invalidImport("import_id must match [A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
	}
	var p *problem
	if req.source, p = parseSource(sourceRaw); p != nil {
		return importRequest{}, p
	}
	if req.target, p = parseTarget(targetRaw); p != nil {
		return importRequest{}, p
	}
	return req, nil
}

func parseSource(raw json.RawMessage) (store.Source, *problem) {
	bad := invalidImport("source must be {app, install_id, local_profile_id}: app expo or android, identifiers of 1 to 128 bytes")
	members, ok := objectMembers(raw)
	app, okApp := jsonString(members["app"])
	install, okInstall := jsonString(members["install_id"])
	local, okLocal := jsonString(members["local_profile_id"])
	if !ok || len(members) != 3 || !okApp || !okInstall || !okLocal {
		return store.Source{}, bad
	}
	if hasNUL(app) || hasNUL(install) || hasNUL(local) {
		return store.Source{}, nulInIndexedText()
	}
	if (app != "expo" && app != "android") || !idText(install) || !idText(local) {
		return store.Source{}, bad
	}
	return store.Source{App: app, InstallID: install, LocalProfileID: local}, nil
}

func parseTarget(raw json.RawMessage) (importTarget, *problem) {
	members, ok := objectMembers(raw)
	if !ok || len(members) != 1 {
		return importTarget{}, invalidImport(`target must be {"new_profile":{...}} or {"profile_id":"..."}`)
	}
	if v, named := members["profile_id"]; named {
		id, isString := jsonString(v)
		if !isString {
			return importTarget{}, invalidImport("target.profile_id must be a string")
		}
		return importTarget{profileID: id}, nil
	}
	np, p := parseNewProfile(members["new_profile"])
	if p != nil {
		return importTarget{}, p
	}
	return importTarget{newProfile: np}, nil
}

// parseNewProfile accepts kind "adult", optional settings and the guest's consent: nothing that
// identifies the learner.
func parseNewProfile(raw json.RawMessage) (*store.NewProfile, *problem) {
	members, ok := objectMembers(raw)
	if !ok {
		return nil, invalidImport("new_profile must be an object")
	}
	for name := range members {
		if name != "kind" && name != "settings" && name != "consent" {
			return nil, invalidImport("new_profile holds only kind, settings and consent: no label, name, birth year, email or other identifying member")
		}
	}
	kind, ok := jsonString(members["kind"])
	if !ok {
		return nil, invalidImport("new_profile.kind is required")
	}
	if kind != "adult" {
		return nil, newProblem(http.StatusUnprocessableEntity, codeUnsupportedProfileKind, "only adult profiles can be created; child profiles stay on the device")
	}
	np := &store.NewProfile{}
	if s, named := members["settings"]; named {
		patch, valid := parseSettings(s)
		if !valid {
			return nil, invalidImport(settingsRule)
		}
		np.Settings = patch.apply(store.Settings{})
	}
	members, ok = objectMembers(members["consent"])
	version, okVersion := jsonString(members["version"])
	at, okAt := jsonString(members["at"])
	if !ok || len(members) != 2 || !okVersion || !okAt {
		return nil, invalidImport(`new_profile.consent must be {"version": 1 to 128 bytes, "at": an RFC 3339 date-time with offset}`)
	}
	if hasNUL(version) || hasNUL(at) {
		return nil, nulInIndexedText()
	}
	consentAt, err := time.Parse(time.RFC3339Nano, at)
	if !idText(version) || err != nil {
		return nil, invalidImport(`new_profile.consent must be {"version": 1 to 128 bytes, "at": an RFC 3339 date-time with offset}`)
	}
	np.ConsentVersion, np.ConsentAt = version, consentAt
	return np, nil
}

func idText(s string) bool {
	return s != "" && len(s) <= maxIDBytes
}

func invalidImport(detail string) *problem {
	return newProblem(http.StatusUnprocessableEntity, codeInvalidImport, detail)
}

func nulInIndexedText() *problem {
	return newProblem(http.StatusUnprocessableEntity, codeNULInIndexedText, "identifiers and other indexed text may not contain U+0000")
}

package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"ayailmu.local/backend/internal/store"
)

// Setting ranges, the same as the profiles table's checks.
const (
	minSessionMinutes = 1
	maxSessionMinutes = 240
	minArabicScale    = 0.8
	maxArabicScale    = 2.0
)

const settingsRule = "settings accepts instruction_lang (id or en), session_minutes (an integer from 1 to 240) and arabic_scale (0.8 to 2.0); null removes a setting"

type profileDoc struct {
	ProfileID string      `json:"profile_id"`
	Kind      string      `json:"kind"`
	Revision  int64       `json:"revision"`
	HighSeq   int64       `json:"high_seq"`
	Settings  settingsDoc `json:"settings"`
	Consent   consentDoc  `json:"consent"`
	Sources   []sourceDoc `json:"sources"`
}

// settingsDoc omits unset settings, as RFC 7396 removes members patched to null.
type settingsDoc struct {
	InstructionLang *string  `json:"instruction_lang,omitempty"`
	SessionMinutes  *int     `json:"session_minutes,omitempty"`
	ArabicScale     *float64 `json:"arabic_scale,omitempty"`
}

type consentDoc struct {
	Version string `json:"version"`
	At      string `json:"at"`
}

type sourceDoc struct {
	App            string `json:"app"`
	InstallID      string `json:"install_id"`
	LocalProfileID string `json:"local_profile_id"`
}

func profileDocOf(p store.Profile) profileDoc {
	doc := profileDoc{
		ProfileID: p.ProfileID,
		Kind:      p.Kind,
		Revision:  p.Revision,
		HighSeq:   p.HighSeq,
		Settings:  settingsDoc{InstructionLang: p.Settings.InstructionLang, SessionMinutes: p.Settings.SessionMinutes, ArabicScale: p.Settings.ArabicScale},
		Consent:   consentDoc{Version: p.ConsentVersion, At: store.FormatTime(p.ConsentAt)},
		Sources:   make([]sourceDoc, 0, len(p.Sources)),
	}
	for _, s := range p.Sources {
		doc.Sources = append(doc.Sources, sourceDoc{App: s.App, InstallID: s.InstallID, LocalProfileID: s.LocalProfileID})
	}
	return doc
}

func etag(revision int64) string {
	return `"r` + strconv.FormatInt(revision, 10) + `"`
}

func writeProfile(w http.ResponseWriter, p store.Profile) {
	w.Header().Set("ETag", etag(p.Revision))
	writeJSON(w, http.StatusOK, profileDocOf(p))
}

// writeRevisionConflict answers a stale If-Match with the current document and its ETag.
func writeRevisionConflict(w http.ResponseWriter, cur store.Profile) {
	doc := profileDocOf(cur)
	p := newProblem(http.StatusPreconditionFailed, codeRevisionConflict, "the profile changed since the If-Match revision; current holds it now")
	p.Current = &doc
	w.Header().Set("ETag", etag(cur.Revision))
	writeProblem(w, p)
}

// ownedProfile answers 404 unless the caller owns the {pid} profile, and reports whether it does. A
// malformed ID, a missing profile and another account's profile get the same response; a profile an
// erasure removed after the request was authenticated gets 410.
func (h *handler) ownedProfile(w http.ResponseWriter, r *http.Request, c *call) bool {
	owned, err := h.store.OwnsProfile(r.Context(), c.accountID, c.profileID)
	switch {
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
	case err != nil:
		h.internal(w, "resolve profile", err)
	case !owned:
		writeNotFound(w)
	}
	return err == nil && owned
}

func (h *handler) getProfile(w http.ResponseWriter, r *http.Request, c *call) {
	p, err := h.store.Profile(r.Context(), c.accountID, c.profileID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
	case err != nil:
		h.internal(w, "read profile", err)
	default:
		writeProfile(w, p)
	}
}

// patchProfile serves PATCH /v1/profiles/{pid} (contract §4). The profile is resolved first (404), then
// the precondition (428, 412), then the patch (400, 422). An update applies only while the revision is
// still the one If-Match named, so concurrent edits surface as 412, never as a silent overwrite.
func (h *handler) patchProfile(w http.ResponseWriter, r *http.Request, c *call) {
	cur, err := h.store.Profile(r.Context(), c.accountID, c.profileID)
	if errors.Is(err, store.ErrNotFound) {
		writeNotFound(w)
		return
	}
	if errors.Is(err, store.ErrAccountDeleted) {
		writeAccountDeleted(w)
		return
	}
	if err != nil {
		h.internal(w, "read profile", err)
		return
	}
	revisions, ok := ifMatchRevisions(r.Header.Values("If-Match"))
	if !ok {
		writeProblem(w, newProblem(http.StatusPreconditionRequired, codePreconditionRequired, `a profile patch needs If-Match with the revision ETag it is based on, such as "r1"`))
		return
	}
	if !slices.Contains(revisions, cur.Revision) {
		writeRevisionConflict(w, cur)
		return
	}
	patch, p := parseProfilePatch(c.body)
	if p != nil {
		writeProblem(w, p)
		return
	}
	next := patch.apply(cur.Settings)
	if sameSettings(next, cur.Settings) {
		writeProfile(w, cur)
		return
	}
	updated, err := h.store.UpdateSettings(r.Context(), c.accountID, c.profileID, cur.Revision, next)
	switch {
	case errors.Is(err, store.ErrRevisionConflict):
		writeRevisionConflict(w, updated)
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
	case err != nil:
		h.internal(w, "update profile", err)
	default:
		writeProfile(w, updated)
	}
}

// ifMatchRevisions reads If-Match as a list of strong revision ETags such as "r1". ok is false when the
// header is absent, "*", weak or malformed: a patch must name the revision it is based on.
func ifMatchRevisions(values []string) ([]int64, bool) {
	var revisions []int64
	for _, v := range values {
		for _, tag := range strings.Split(v, ",") {
			rev, ok := parseRevisionTag(strings.TrimSpace(tag))
			if !ok {
				return nil, false
			}
			revisions = append(revisions, rev)
		}
	}
	return revisions, len(revisions) > 0
}

// parseRevisionTag reads the strong entity tag "r<revision>".
func parseRevisionTag(tag string) (int64, bool) {
	if len(tag) < 4 || !strings.HasPrefix(tag, `"r`) || !strings.HasSuffix(tag, `"`) {
		return 0, false
	}
	digits := tag[2 : len(tag)-1]
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return 0, false
		}
	}
	rev, err := strconv.ParseInt(digits, 10, 64)
	return rev, err == nil && rev >= 1
}

// parseProfilePatch validates an RFC 7396 merge patch of the profile: settings is its only patchable
// member.
func parseProfilePatch(body []byte) (settingsPatch, *problem) {
	if p := strictJSON(body); p != nil {
		return settingsPatch{}, p
	}
	members, ok := objectMembers(body)
	if !ok {
		return settingsPatch{}, invalidRequest("a profile patch must be a JSON object (RFC 7396)")
	}
	for name := range members {
		if name != "settings" {
			return settingsPatch{}, newProblem(http.StatusUnprocessableEntity, codeProfileFieldNotPatchable, "only settings can be patched; kind, consent, sources, server fields and identifying members cannot")
		}
	}
	raw, ok := members["settings"]
	if !ok {
		return settingsPatch{}, nil // {} changes nothing
	}
	patch, ok := parseSettings(raw)
	if !ok {
		return settingsPatch{}, newProblem(http.StatusUnprocessableEntity, codeInvalidProfilePatch, settingsRule)
	}
	return patch, nil
}

// settingsPatch is a validated RFC 7396 patch of the settings object.
type settingsPatch struct {
	clearAll bool // "settings": null removes every setting
	lang     optional[string]
	minutes  optional[int]
	scale    optional[float64]
}

// optional is one setting of a patch: whether the patch names it, and its new value (nil removes it).
type optional[T any] struct {
	named bool
	value *T
}

func (p settingsPatch) apply(cur store.Settings) store.Settings {
	next := cur
	if p.clearAll {
		next = store.Settings{}
	}
	if p.lang.named {
		next.InstructionLang = p.lang.value
	}
	if p.minutes.named {
		next.SessionMinutes = p.minutes.value
	}
	if p.scale.named {
		next.ArabicScale = p.scale.value
	}
	return next
}

// parseSettings validates a settings value: null, or an object whose members are known settings set to
// null or to an allowed value.
func parseSettings(raw json.RawMessage) (settingsPatch, bool) {
	var p settingsPatch
	if string(raw) == "null" {
		p.clearAll = true
		return p, true
	}
	members, ok := objectMembers(raw)
	if !ok {
		return settingsPatch{}, false
	}
	for name, v := range members {
		var valid bool
		switch name {
		case "instruction_lang":
			p.lang, valid = parseSetting(v, func(raw json.RawMessage) (string, bool) {
				s, ok := jsonString(raw)
				return s, ok && (s == "id" || s == "en")
			})
		case "session_minutes":
			p.minutes, valid = parseSetting(v, func(raw json.RawMessage) (int, bool) {
				n, ok := integerLiteral(raw)
				return n, ok && n >= minSessionMinutes && n <= maxSessionMinutes
			})
		case "arabic_scale":
			p.scale, valid = parseSetting(v, func(raw json.RawMessage) (float64, bool) {
				f, ok := numberLiteral(raw)
				return f, ok && f >= minArabicScale && f <= maxArabicScale
			})
		}
		if !valid {
			return settingsPatch{}, false
		}
	}
	return p, true
}

// parseSetting reads one patched setting: null removes it, anything else must pass check.
func parseSetting[T any](raw json.RawMessage, check func(json.RawMessage) (T, bool)) (optional[T], bool) {
	if string(raw) == "null" {
		return optional[T]{named: true}, true
	}
	v, ok := check(raw)
	if !ok {
		return optional[T]{}, false
	}
	return optional[T]{named: true, value: &v}, true
}

func sameSettings(a, b store.Settings) bool {
	return samePtr(a.InstructionLang, b.InstructionLang) && samePtr(a.SessionMinutes, b.SessionMinutes) && samePtr(a.ArabicScale, b.ArabicScale)
}

func samePtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

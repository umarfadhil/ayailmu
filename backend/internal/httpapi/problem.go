package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
)

// problemTypePrefix turns each stable code into its problem type URI (RFC 9457). The URIs identify
// problem types; nothing serves them.
const problemTypePrefix = "urn:ayailmu:problem:"

// Stable problem codes: part of the API contract.
const (
	codeHostNotAllowed       = "host_not_allowed"
	codeOriginNotAllowed     = "origin_not_allowed"
	codeInvalidPreflight     = "invalid_preflight"
	codeUnauthenticated      = "unauthenticated"
	codeNotFound             = "not_found"
	codeMethodNotAllowed     = "method_not_allowed"
	codeUnsupportedMediaType = "unsupported_media_type"
	codeBodyTooLarge         = "body_too_large"
	codeBatchTooLarge        = "batch_too_large"
	codeInvalidJSON          = "invalid_json"
	codeInvalidRequest       = "invalid_request"
	codeInvalidQuery         = "invalid_query"

	codePreconditionRequired     = "precondition_required"
	codeRevisionConflict         = "revision_conflict"
	codeInvalidProfilePatch      = "invalid_profile_patch"
	codeProfileFieldNotPatchable = "profile_field_not_patchable"

	codeInvalidImport          = "invalid_import"
	codeUnsupportedProfileKind = "unsupported_profile_kind"
	codeNULInIndexedText       = "nul_in_indexed_text"
	codeImportIDReused         = "import_id_reused"
	codeSourceAlreadyLinked    = "source_already_linked"
	codeSourceNotLinked        = "source_not_linked"
	codeEventConflict          = "event_conflict"
	codeImportRejected         = "import_rejected"

	codeAccountDeleted           = "account_deleted"
	codeReauthenticationRequired = "reauthentication_required"
	codeDeletionNotConfirmed     = "deletion_not_confirmed"
	codeAccountDeletionFailed    = "account_deletion_failed"
	codeExportTooLarge           = "export_too_large"

	codeInternal = "internal_error"
)

var problemTitles = map[string]string{
	codeHostNotAllowed:       "Host not allowed",
	codeOriginNotAllowed:     "Origin not allowed",
	codeInvalidPreflight:     "Invalid preflight",
	codeUnauthenticated:      "Authentication required",
	codeNotFound:             "Not found",
	codeMethodNotAllowed:     "Method not allowed",
	codeUnsupportedMediaType: "Unsupported media type",
	codeBodyTooLarge:         "Request body too large",
	codeBatchTooLarge:        "Batch too large",
	codeInvalidJSON:          "Malformed JSON",
	codeInvalidRequest:       "Invalid request",
	codeInvalidQuery:         "Invalid query",

	codePreconditionRequired:     "Precondition required",
	codeRevisionConflict:         "Revision conflict",
	codeInvalidProfilePatch:      "Invalid profile patch",
	codeProfileFieldNotPatchable: "Profile field not patchable",

	codeInvalidImport:          "Invalid import",
	codeUnsupportedProfileKind: "Unsupported profile kind",
	codeNULInIndexedText:       "NUL in indexed text",
	codeImportIDReused:         "Import ID reused",
	codeSourceAlreadyLinked:    "Source already linked",
	codeSourceNotLinked:        "Source not linked",
	codeEventConflict:          "Event conflict",
	codeImportRejected:         "Import rejected",

	codeAccountDeleted:           "Account deleted",
	codeReauthenticationRequired: "Reauthentication required",
	codeDeletionNotConfirmed:     "Deletion not confirmed",
	codeAccountDeletionFailed:    "Account deletion failed",
	codeExportTooLarge:           "Export too large",

	codeInternal: "Internal error",
}

// problem is an RFC 9457 problem document with a stable code. Detail is fixed server text: problems
// never quote the request. Current (a 412's profile) and Results (an import's failed events) are
// extension members.
type problem struct {
	Type    string        `json:"type"`
	Title   string        `json:"title"`
	Status  int           `json:"status"`
	Code    string        `json:"code"`
	Detail  string        `json:"detail,omitempty"`
	Current *profileDoc   `json:"current,omitempty"`
	Results []eventResult `json:"results,omitempty"`
}

func newProblem(status int, code, detail string) *problem {
	return &problem{Type: problemTypePrefix + code, Title: problemTitles[code], Status: status, Code: code, Detail: detail}
}

func internalProblem() *problem {
	return newProblem(http.StatusInternalServerError, codeInternal, "the request could not be completed")
}

// writeUnauthenticated answers every authentication failure with the same header and body, so the
// response is no oracle for why a token failed.
func writeUnauthenticated(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="ayailmu"`)
	writeProblem(w, newProblem(http.StatusUnauthorized, codeUnauthenticated, "a valid bearer token of a signed-in, non-anonymous user is required"))
}

// writeNotFound is the one 404 body: for unknown routes and for any profile the caller does not own.
func writeNotFound(w http.ResponseWriter) {
	writeProblem(w, newProblem(http.StatusNotFound, codeNotFound, "no such resource"))
}

// writeAccountDeleted is the one 410 body, whatever the route: the account's deletion is recorded.
func writeAccountDeleted(w http.ResponseWriter) {
	writeProblem(w, newProblem(http.StatusGone, codeAccountDeleted, "this account was deleted: its server data is erased and nothing more is accepted for it"))
}

// writeReauthenticationRequired refuses an action that needs a recent sign-in with the RFC 9470
// step-up challenge on the RFC 6750 bearer scheme. The token stays valid for every other route.
func writeReauthenticationRequired(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", stepUpChallenge)
	writeProblem(w, newProblem(http.StatusUnauthorized, codeReauthenticationRequired,
		"this action needs a sign-in from the last 5 minutes: sign in again, then repeat it"))
}

func writeProblem(w http.ResponseWriter, p *problem) {
	writeDocument(w, p.Status, "application/problem+json", p)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	writeDocument(w, status, "application/json", v)
}

// internalDocument is the generic 500 body, encoded once.
var internalDocument = mustEncode(internalProblem())

// writeDocument encodes v, always one of this package's response types, and writes it with its
// length. Pull pages, which carry stored payload bytes, are written by writePage instead.
func writeDocument(w http.ResponseWriter, status int, contentType string, v any) {
	body, err := encode(v)
	if err != nil {
		status, contentType, body = http.StatusInternalServerError, "application/problem+json", internalDocument
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func mustEncode(v any) []byte {
	b, err := encode(v)
	if err != nil {
		panic(err)
	}
	return b
}

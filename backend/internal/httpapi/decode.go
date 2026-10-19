package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"ayailmu.local/backend/internal/envelope"
)

// maxBatch is the most envelopes one events request may carry.
const maxBatch = 500

// objectMembers splits a JSON object into its members, keeping each value's exact bytes. It reports
// false for anything but an object and for a repeated member name (compared after unescaping).
// readBody has already checked the syntax.
func objectMembers(raw []byte) (map[string]json.RawMessage, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, false
	}
	members := make(map[string]json.RawMessage)
	for dec.More() {
		tok, err := dec.Token()
		key, isKey := tok.(string)
		if err != nil || !isKey {
			return nil, false
		}
		if _, repeated := members[key]; repeated {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		members[key] = v
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, false
	}
	return members, true
}

// arrayElements splits a JSON array into its elements' exact bytes. isArray is false for anything but
// an array; tooMany reports more than limit elements.
func arrayElements(raw []byte, limit int) (elems []json.RawMessage, isArray, tooMany bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return nil, false, false
	}
	for dec.More() {
		if len(elems) == limit {
			return nil, true, true
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false, false
		}
		elems = append(elems, v)
	}
	return elems, true, false
}

// batchEnvelopes reads an events request, {"events":[1 to 500 envelopes]} and nothing else, and
// returns each envelope's exact bytes for envelope.Parse.
func batchEnvelopes(body []byte) ([]json.RawMessage, *problem) {
	members, ok := objectMembers(body)
	raw, hasEvents := members["events"]
	if !ok || !hasEvents || len(members) != 1 {
		return nil, invalidRequest(`the body must be {"events":[...]} with no other member`)
	}
	envs, isArray, tooMany := arrayElements(raw, maxBatch)
	switch {
	case tooMany:
		return nil, newProblem(http.StatusRequestEntityTooLarge, codeBatchTooLarge, "a batch holds at most 500 events")
	case !isArray || len(envs) == 0:
		return nil, invalidRequest("events must be an array of 1 to 500 envelopes")
	}
	return envs, nil
}

func invalidRequest(detail string) *problem {
	return newProblem(http.StatusBadRequest, codeInvalidRequest, detail)
}

// strictJSON applies the envelope canonicalizer's rules to request JSON outside the events: valid
// UTF-8, no unpaired surrogate escape and no repeated member name at any depth.
func strictJSON(raw []byte) *problem {
	_, err := envelope.Canonicalize(raw)
	if err == nil {
		return nil
	}
	var p *envelope.Problem
	if errors.As(err, &p) && p.Code == envelope.CodeDuplicateKey {
		return invalidRequest("a request object repeats a member name")
	}
	return newProblem(http.StatusBadRequest, codeInvalidJSON, "the request body is not valid UTF-8 JSON")
}

// jsonString decodes raw when it is a JSON string. Callers run strictJSON first, so the decoder never
// substitutes U+FFFD.
func jsonString(raw json.RawMessage) (string, bool) {
	if !startsWith(raw, '"') {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// startsWith reports whether a JSON value's exact bytes begin with c: '"' for a string, '{' for an
// object.
func startsWith(raw json.RawMessage, c byte) bool {
	return len(raw) > 0 && raw[0] == c
}

// integerLiteral reads a JSON number written as an integer, without fraction or exponent.
func integerLiteral(raw json.RawMessage) (int, bool) {
	s := string(raw)
	if s == "" || strings.ContainsAny(s, ".eE") || (s[0] != '-' && (s[0] < '0' || s[0] > '9')) {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	return n, err == nil
}

// numberLiteral reads a finite JSON number.
func numberLiteral(raw json.RawMessage) (float64, bool) {
	s := string(raw)
	if s == "" || (s[0] != '-' && (s[0] < '0' || s[0] > '9')) {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil && !math.IsInf(f, 0) && !math.IsNaN(f)
}

// hasNUL reports U+0000, which PostgreSQL text cannot hold.
func hasNUL(s string) bool {
	return strings.IndexByte(s, 0) >= 0
}

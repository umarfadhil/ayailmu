package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

// hostAllowed is the DNS-rebinding guard: the Host must be the listen address or localhost:<port>.
func (h *handler) hostAllowed(host string) bool {
	for _, allowed := range h.hosts {
		if strings.EqualFold(host, allowed) {
			return true
		}
	}
	return false
}

// readBody applies the media-type, size and JSON-syntax guards and returns the exact body. It checks
// syntax only: invalid UTF-8 or a repeated member inside one envelope is that envelope's own problem,
// reported per event.
func readBody(rw http.ResponseWriter, r *http.Request, mediaType string, maxBytes int64) ([]byte, *problem) {
	if ct := r.Header.Values("Content-Type"); len(ct) != 1 || !mediaTypeIs(ct[0], mediaType) {
		return nil, newProblem(http.StatusUnsupportedMediaType, codeUnsupportedMediaType, "the request body must be "+mediaType)
	}
	if r.ContentLength > maxBytes {
		return nil, bodyTooLarge(maxBytes)
	}
	body, err := io.ReadAll(http.MaxBytesReader(rw, r.Body, maxBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, bodyTooLarge(maxBytes)
		}
		return nil, newProblem(http.StatusBadRequest, codeInvalidRequest, "the request body could not be read")
	}
	if !json.Valid(body) {
		return nil, newProblem(http.StatusBadRequest, codeInvalidJSON, "the request body is not well-formed JSON")
	}
	return body, nil
}

func bodyTooLarge(maxBytes int64) *problem {
	return newProblem(http.StatusRequestEntityTooLarge, codeBodyTooLarge, fmt.Sprintf("the request body exceeds %d bytes", maxBytes))
}

// mediaTypeIs accepts exactly want, optionally with charset=utf-8.
func mediaTypeIs(header, want string) bool {
	mt, params, err := mime.ParseMediaType(header)
	if err != nil || mt != want {
		return false
	}
	for k, v := range params {
		if k != "charset" || !strings.EqualFold(v, "utf-8") {
			return false
		}
	}
	return true
}

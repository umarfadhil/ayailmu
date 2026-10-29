package api

import (
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"net/http"
	"net/url"
	"strconv"
)

type cursor struct {
	after int64
	limit int
}

func parseCursor(r *http.Request) (cursor, error) {
	c := cursor{limit: 100}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return c, err
	}
	for k, values := range q {
		if len(values) != 1 || (k != "after" && k != "limit") {
			return c, store.ErrInvalid
		}
	}
	if v, ok := q["after"]; ok {
		c.after, err = strconv.ParseInt(v[0], 10, 64)
		if err != nil || c.after < 0 {
			return c, store.ErrInvalid
		}
	}
	if v, ok := q["limit"]; ok {
		c.limit, err = strconv.Atoi(v[0])
		if err != nil || c.limit < 1 || c.limit > 100 {
			return c, store.ErrInvalid
		}
	}
	return c, nil
}

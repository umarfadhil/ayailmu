package store

import (
	"crypto/tls"
	"errors"
	"net"

	"github.com/jackc/pgx/v5/pgconn"
)

var errRemoteDatabaseTransport = errors.New("remote database transport validation failed")

func validateDatabaseTransport(config *pgconn.Config) error {
	if err := validateTargetTransport(config.Host, config.TLSConfig); err != nil {
		return err
	}
	for _, fallback := range config.Fallbacks {
		if err := validateTargetTransport(fallback.Host, fallback.TLSConfig); err != nil {
			return err
		}
	}
	return nil
}

func validateTargetTransport(host string, tlsConfig *tls.Config) error {
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	if network, _ := pgconn.NetworkAddress(host, 0); network == "unix" {
		return nil
	}
	if tlsConfig == nil || tlsConfig.InsecureSkipVerify || tlsConfig.ServerName == "" || tlsConfig.ServerName != host {
		return errRemoteDatabaseTransport
	}
	return nil
}

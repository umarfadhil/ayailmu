package labconfig

import (
	"errors"
	"net"
	"strconv"
	"time"
)

func RouterLimits(address string, duration time.Duration) error {
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("router requires an explicit loopback listen address")
	}
	ip := net.ParseIP(host)
	port, err := strconv.Atoi(rawPort)
	if ip == nil || !ip.IsLoopback() || err != nil || port < 1 || port > 65535 {
		return errors.New("router requires an explicit loopback listen address and nonzero port")
	}
	if duration < time.Second || duration > 30*time.Minute {
		return errors.New("router lifetime must be between one second and thirty minutes")
	}
	return nil
}

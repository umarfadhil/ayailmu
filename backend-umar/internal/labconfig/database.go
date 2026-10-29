package labconfig

import "errors"

func MigrateOnStart(value string) (bool, error) {
	switch value {
	case "", "true":
		return true, nil // Preserve existing local lab startup.
	case "false":
		return false, nil
	default:
		return false, errors.New("UMAR_MIGRATE_ON_START must be true or false")
	}
}

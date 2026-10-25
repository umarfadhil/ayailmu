package config

// The settings of the deletion-ledger operator tool (cmd/ayailmu-ledger). Both loaders compose the guards this package
// already applies to the migration job and to local-compose: refuseLocalVariables, loadDeployDatabase, loadSchema and
// loadComposeAuth.

// LedgerOperator is the configuration of the deletion-ledger operator tool: the operator's database URL from its private
// file, the schema and the exact database hosts pgx may dial, as the migration job takes them; the trusted issuer every
// ledger entry belongs to; and, for a replay only, the stack's own Auth, whose admin API deletes each entry's exact
// identity.
type LedgerOperator struct {
	DatabaseURL Secret
	Schema      string
	DBHosts     []string
	// Issuer is the exact issuer of the trusted provider's tokens (AYA_SUPABASE_ISSUER). Every ledger entry must name it,
	// with the local-supabase auth mode; no identity is ever looked up by anything else, an email least of all.
	Issuer string
	// Supabase is, for a replay, the stack's Auth exactly as ModeLocalCompose takes it: a URL naming exactly one of
	// AYA_AUTH_HOSTS, the issuer (Issuer), the audience and the admin credential from its private file. Zero for an
	// export.
	Supabase Supabase
	// DBPrivateNetwork is true only when AYA_DB_TRANSPORT=private-network explicitly allows plaintext to a private target.
	DBPrivateNetwork bool
}

// LoadLedgerExport reads an export's settings through lookup, under the migration job's guards (LoadMigration): no
// emulator or Google variable, even empty; the database URL from its private file only, never AYA_DATABASE_URL, even
// empty; every database host in AYA_DB_HOSTS; and a valid schema. It also takes the trusted issuer (missing:
// ErrMissing; not 1 to 256 bytes of visible ASCII: ErrInvalidAuthSetting). An export deletes no identity, so it refuses
// the Auth URL, the Auth host list, the audience and the admin credential file, even empty, with ErrSettingNotUsed. Each
// refusal names its variable and quotes nothing it was given.
func LoadLedgerExport(lookup func(string) (string, bool)) (LedgerOperator, error) {
	if err := refuseLocalVariables(lookup); err != nil {
		return LedgerOperator{}, err
	}
	for _, name := range []string{EnvSupabaseURL, EnvAuthHosts, EnvSupabaseAudience, EnvSupabaseAdminKeyFile} {
		if _, set := lookup(name); set {
			return LedgerOperator{}, refuse(ErrSettingNotUsed, name)
		}
	}
	return loadLedgerOperator(lookup)
}

// LoadLedgerReplay reads a replay's settings: the database and the trusted issuer as LoadLedgerExport does, and the
// stack's Auth exactly as ModeLocalCompose takes it (loadComposeAuth): the URL naming exactly one of AYA_AUTH_HOSTS, the
// audience and the admin credential from its private file. Each refusal names its variable and quotes nothing it was
// given.
func LoadLedgerReplay(lookup func(string) (string, bool)) (LedgerOperator, error) {
	if err := refuseLocalVariables(lookup); err != nil {
		return LedgerOperator{}, err
	}
	op, err := loadLedgerOperator(lookup)
	if err != nil {
		return LedgerOperator{}, err
	}
	if op.Supabase, err = loadComposeAuth(getter(lookup)); err != nil {
		return LedgerOperator{}, err
	}
	return op, nil
}

// loadLedgerOperator reads what both commands take, after their callers refused the local variables: the database as
// the migration job takes it, and the trusted issuer.
func loadLedgerOperator(lookup func(string) (string, bool)) (LedgerOperator, error) {
	dsn, hosts, err := loadDeployDatabase(lookup)
	if err != nil {
		return LedgerOperator{}, err
	}
	get := getter(lookup)
	schema, err := loadSchema(get)
	if err != nil {
		return LedgerOperator{}, err
	}
	issuer := get(EnvSupabaseIssuer)
	switch {
	case issuer == "":
		return LedgerOperator{}, refuse(ErrMissing, EnvSupabaseIssuer)
	case !isVisibleASCII(issuer, maxAuthSettingBytes):
		return LedgerOperator{}, refuse(ErrInvalidAuthSetting, EnvSupabaseIssuer)
	}
	private, err := loadDBTransport(lookup, false)
	if err != nil {
		return LedgerOperator{}, err
	}
	return LedgerOperator{DatabaseURL: dsn, Schema: schema, DBHosts: hosts, Issuer: issuer, DBPrivateNetwork: private}, nil
}

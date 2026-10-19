# aya-drill-init (deploy/restore/source.yaml and target.yaml): copies the restore drill's own private files from the
# drill's per-stack directory, bind-mounted read-only at /in, into the drill volumes mounted at /out/<name>. Every
# file becomes owned by 65532 (the user of the ledger and probe one-shots) with mode 0400, and every volume root 0700
# and 65532's. A volume receives exactly /in/<name>; a volume without files (the export's output) only gets its owner
# and mode. It runs as aya-secrets-init does: root only for chown and for reading the host user's 0600 files, no
# network. It prints a count and refusals by file name only, never a content, and traces nothing.
set -eu
umask 077

count=0
for out in /out/*; do
	[ -d "$out" ] || continue
	name=${out##*/}
	chown 65532:65532 "$out"
	chmod 0700 "$out"
	[ -d "/in/$name" ] || continue
	for path in "/in/$name"/*; do
		[ -e "$path" ] || continue
		if [ ! -f "$path" ] || [ -L "$path" ]; then
			echo "aya-drill-init: not a regular file: $name/${path##*/}" >&2
			exit 1
		fi
		install -m 0400 -o 65532 -g 65532 -- "$path" "$out/${path##*/}"
		count=$((count + 1))
	done
done
echo "aya-drill-init: copied $count private files into the drill volumes"

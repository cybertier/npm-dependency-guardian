# Usage

```
node src/main.js PATH [--overwrite --locations --member-access-tracing --no-backup --custom-modules --json --policy-path PATH]
```

Parameters:

- `--overwrite`: overwrite the old policy file with the newly generated one
- `--locations`: build the AST including source code locations, mainly for debugging purposes
- `--member-access-tracing`: apply member access tracing
- `--no-backup`: do not create a backup of the previous policy
- `--custom-modules`: create the policy for third-party modules instead of build-in modules
- `--json`: output the changes in json format
- `--policy-path PATH`: use a custom path for the policy. Default: `/tmp/node_policy.json`

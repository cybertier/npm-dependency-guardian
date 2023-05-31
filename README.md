# Npm Dependency Guardian

This project aims to provide runtime protection against malicious npm package updates by enforcing minimum capabilities of "trusted" versions for new updates.

The program located in [./npm-dependency-guardian](./npm-dependency-guardian) provides functionality to create policy files containing the capabilities of an existing NodeJS package.
The scripts and git patch found in [./nodejs-patch](./nodejs-patch) allow you to create a patched version of NodeJS that enforces this policy.

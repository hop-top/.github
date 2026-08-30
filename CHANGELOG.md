# Changelog

## [0.11.0](https://github.com/hop-top/.github/compare/v0.10.0...v0.11.0) (2026-08-30)


### Features

* **community:** org defaults, release-bot concept, docs alignment ([#57](https://github.com/hop-top/.github/issues/57)) ([1eda4ff](https://github.com/hop-top/.github/commit/1eda4ff02f5c993f3fce07ab76f5d47f32235aad))
* **workflows:** add release-tag-on-merge reusable ([#62](https://github.com/hop-top/.github/issues/62)) ([594540b](https://github.com/hop-top/.github/commit/594540b9b91126788d80f61b29fbad3cd6e9d535))


### Bug Fixes

* **mirror-subtree:** correct prerelease flag and stale releases on retag ([#61](https://github.com/hop-top/.github/issues/61)) ([cdcc3c8](https://github.com/hop-top/.github/commit/cdcc3c8550e545a8772a4bf8b43f2ce381d7205d))

## [0.10.0](https://github.com/hop-top/.github/compare/v0.9.2...v0.10.0) (2026-05-25)


### Features

* **publish-on-tag:** dispatch repo-map-update on Go release ([#50](https://github.com/hop-top/.github/issues/50)) ([2390ad3](https://github.com/hop-top/.github/commit/2390ad3d15bbd22eb6a6dfb4e7f66dc740db780d))

## [0.9.2](https://github.com/hop-top/.github/compare/v0.9.1...v0.9.2) (2026-05-24)


### Bug Fixes

* **preflight:** auto-detect single-language adopters; demote publish.yml checks ([#47](https://github.com/hop-top/.github/issues/47)) ([7a318da](https://github.com/hop-top/.github/commit/7a318daf6c8176e1551c22bc09786d8127825152))

## [0.9.1](https://github.com/hop-top/.github/compare/v0.9.0...v0.9.1) (2026-05-23)


### Bug Fixes

* **publish:** gate publish-php with always() so php tags actually notify Packagist ([#43](https://github.com/hop-top/.github/issues/43)) ([9179dce](https://github.com/hop-top/.github/commit/9179dce984eabc5d92330525ac0b5a8484ad8c38))

## [0.9.0](https://github.com/hop-top/.github/compare/v0.8.1...v0.9.0) (2026-05-23)


### Features

* **publish:** add publish-php Packagist notifier ([#41](https://github.com/hop-top/.github/issues/41)) ([77060a9](https://github.com/hop-top/.github/commit/77060a9f8d1194cda3c22489f08d6d61c124063e))

## [0.8.1](https://github.com/hop-top/.github/compare/v0.8.0...v0.8.1) (2026-05-20)


### Bug Fixes

* **preflight:** handle PyYAML's on/off-as-boolean quirk in workflow parsing ([#37](https://github.com/hop-top/.github/issues/37)) ([2f23d52](https://github.com/hop-top/.github/commit/2f23d52af2cf34beada785a5d6de63e66f8efafe))

## [0.8.0](https://github.com/hop-top/.github/compare/v0.7.0...v0.8.0) (2026-05-20)


### Features

* **preflight:** release-please-preflight reusable workflow + SemVer ∩ PEP 440 docs ([#35](https://github.com/hop-top/.github/issues/35)) ([56ee8b3](https://github.com/hop-top/.github/commit/56ee8b322a292ffede14b9ab04bde09cf7d4d53d))

## [0.7.0](https://github.com/hop-top/.github/compare/v0.6.0...v0.7.0) (2026-05-18)


### Features

* **goreleaser-on-tag:** WinGet support for Windows ([7730848](https://github.com/hop-top/.github/commit/7730848764dc0e585be01b8c7e68c9be0ad3751a))
* **publish-on-tag:** enable-mirror opt-out + self-mirror guard + drop archive flag ([dcdea68](https://github.com/hop-top/.github/commit/dcdea68a50027d811603c9d5cd8699218b1951f7))

## [0.6.0](https://github.com/hop-top/.github/compare/v0.5.1...v0.6.0) (2026-05-18)


### Features

* **goreleaser-on-tag:** add scoop-bucket-repo input for Scoop manifests ([62bd9f2](https://github.com/hop-top/.github/commit/62bd9f29c6a15f1593a71f1cb86a04e9a35bc16f))
* **goreleaser-on-tag:** Scoop bucket support for Windows ([aabf839](https://github.com/hop-top/.github/commit/aabf83904fc9c4a6a4de5ead757df47ea5f746fc))

## [0.5.1](https://github.com/hop-top/.github/compare/v0.5.0...v0.5.1) (2026-05-18)


### Bug Fixes

* **goreleaser-on-tag:** handle plain v-prefix tag case in synthesis step ([703a4aa](https://github.com/hop-top/.github/commit/703a4aaeaa429672b70267b447073f91d4e52b63))
* **workflows:** synthesize bare-tag for GoReleaser + upload via gh ([2f1f282](https://github.com/hop-top/.github/commit/2f1f2829bd3fe9164be5a120ab9dba56eb9833f4))
* **workflows:** synthesize bare-tag for GoReleaser + upload via gh release ([01a9314](https://github.com/hop-top/.github/commit/01a9314f014899044cf272dd5fa6a5fcdfc55823))

## [0.5.0](https://github.com/hop-top/.github/compare/v0.4.3...v0.5.0) (2026-05-18)


### Features

* **workflows:** add goreleaser-on-tag reusable workflow ([bd14995](https://github.com/hop-top/.github/commit/bd14995f8caf466bf643587e101c17b8f3232ec1))
* **workflows:** add goreleaser-on-tag reusable workflow ([32508db](https://github.com/hop-top/.github/commit/32508dbd56210e1ebef37042cc3976712c80bab1))


### Bug Fixes

* address PR [#23](https://github.com/hop-top/.github/issues/23) review feedback ([f5a12fc](https://github.com/hop-top/.github/commit/f5a12fc882058c363e40aa505fbbe9faf0edaa24))


### Refactoring

* **skill:** generalize binaries section, move Go content to per-language doc ([f310cd3](https://github.com/hop-top/.github/commit/f310cd3c3e79ab7a6cb8826dc21fba927a5d3498))

## [0.4.3](https://github.com/hop-top/.github/compare/v0.4.2...v0.4.3) (2026-05-17)


### Bug Fixes

* **publish-{py,rs,ts}:** preserve shell operators in test/build commands ([#18](https://github.com/hop-top/.github/issues/18)) ([ebba049](https://github.com/hop-top/.github/commit/ebba049fe77e03a2bc6fd635e63b97c8c2720aec))

## [0.4.2](https://github.com/hop-top/.github/compare/v0.4.1...v0.4.2) (2026-05-17)


### Bug Fixes

* **mirror-subtree:** strip .github/workflows/ on root-component push ([#16](https://github.com/hop-top/.github/issues/16)) ([6365ec2](https://github.com/hop-top/.github/commit/6365ec270b20c541b9b2fd172e0b91e367af340c))

## [0.4.1](https://github.com/hop-top/.github/compare/v0.4.0...v0.4.1) (2026-05-17)


### Bug Fixes

* **mirror-subtree:** handle root-level component (dir: ".") ([#14](https://github.com/hop-top/.github/issues/14)) ([d7eb0be](https://github.com/hop-top/.github/commit/d7eb0be588e7ee1016dcd23f766d07010b36082d))

## [0.4.0](https://github.com/hop-top/.github/compare/v0.3.0...v0.4.0) (2026-05-16)


### Features

* **publish-py:** add token auth mode as escape hatch from OIDC ([#10](https://github.com/hop-top/.github/issues/10)) ([600c4f6](https://github.com/hop-top/.github/commit/600c4f68ee29820b32df98339d30afb042d09df5))

## [0.3.0](https://github.com/hop-top/.github/compare/v0.2.0...v0.3.0) (2026-05-16)


### Features

* **workflows:** facade pattern docs, install model, ts install default ([6f3ee00](https://github.com/hop-top/.github/commit/6f3ee00d8741910964dfcd106729d87bf61b02b5))


### Bug Fixes

* **workflow:** use exact-match ref endpoint for tag existence probe ([5164bc1](https://github.com/hop-top/.github/commit/5164bc13fce47e21637842e6bc9175536dd0af9d))

## [0.2.0](https://github.com/hop-top/.github/compare/v0.1.0...v0.2.0) (2026-05-16)


### Features

* rolling major tag auto-maintained on releases ([8e6a05a](https://github.com/hop-top/.github/commit/8e6a05a923fcab7fb65776fda1ad3ebfc500b177))


### Bug Fixes

* **workflow:** roll-major-tag failed silently on missing tag ([14be6c1](https://github.com/hop-top/.github/commit/14be6c1dfa76085cec79aa395a99d3e36cba4443))

## 0.1.0 (2026-05-16)


### Features

* org-default repo with reusable release pipeline ([5631938](https://github.com/hop-top/.github/commit/563193845ddfa666876570a876236c3fafb50f38))
* self-release via release-please ([b960260](https://github.com/hop-top/.github/commit/b960260f4a6a1da65324cf7396b9a074f73fc3d8))

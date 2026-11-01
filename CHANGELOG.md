# Changelog

## [0.18.0](https://github.com/hop-top/.github/compare/v0.17.0...v0.18.0) (2026-11-01)


### Features

* **publish-rs:** crates.io trusted publishing via OIDC ([4336453](https://github.com/hop-top/.github/commit/433645363d484935ca58e9e4633fc70f3a0b8fb5))

## [0.17.0](https://github.com/hop-top/.github/compare/v0.16.0...v0.17.0) (2026-10-28)


### Features

* **publish-rs:** opt-in protoc install before cargo steps ([84946b6](https://github.com/hop-top/.github/commit/84946b6ee13b4270da2500989c920d8dcc31c79b))

## [0.16.0](https://github.com/hop-top/.github/compare/v0.15.0...v0.16.0) (2026-10-28)


### Features

* **mirror:** tag-only mode for nested Go modules on an existing mirror ([9e29720](https://github.com/hop-top/.github/commit/9e29720c7dbff609fc3dc905f970cbac508dce7d))


### Bug Fixes

* **mirror:** resolve target name, refuse self-mirror via redirect ([ca0befb](https://github.com/hop-top/.github/commit/ca0befbd0048a03abc92a9eaa478d722cc710db6))

## [0.15.0](https://github.com/hop-top/.github/compare/v0.14.1...v0.15.0) (2026-10-20)


### Features

* **preflight:** accept `versioning: "target"` and validate its plugins ([448e6fc](https://github.com/hop-top/.github/commit/448e6fce48c5c98edecf5bba10e586b09d3caddc))
* **preflight:** validate `x-channel` / `x-open-line` records ([caec9e7](https://github.com/hop-top/.github/commit/caec9e72e13eb77eef287a7d07244434a5b64369))
* **preflight:** warn on dead linked-versions, module leaks, stale pins ([e1c04b3](https://github.com/hop-top/.github/commit/e1c04b37243f37f5206f3b60156f959488577218))
* **release-please-target:** `bin/promote.js` for channel promotions and open lines ([1495d66](https://github.com/hop-top/.github/commit/1495d6688ca1ac2b2ddce1e610a4e9d7c7e48719))
* **release-please-target:** `target` strategy and plugins for release-please ([8650e3d](https://github.com/hop-top/.github/commit/8650e3df908f707b661ba5c387bd58dab8145ae3))
* **release-please-target:** action-equivalent runner ([2c30bdc](https://github.com/hop-top/.github/commit/2c30bdcc8865013485bc44d2cbdccf37d8fc049a))
* **release-please-target:** line-scoped channel promotions, open lines, per-member channels when linked ([1600812](https://github.com/hop-top/.github/commit/1600812c894586597783018df2a68f883d4dd0ab))
* **release-please-target:** target versioning rules ([cdaa946](https://github.com/hop-top/.github/commit/cdaa946cc43dd6a418a03b346a91e09793d830f1))
* **well-known:** $${{ escape publishes a literal ${{ ([ecbe3ae](https://github.com/hop-top/.github/commit/ecbe3aeb1ffdee86019ac7eb7c09e8f1e8252dbc))
* **well-known:** JSON Schema 2020-12 stub with custom escape hatch ([d762964](https://github.com/hop-top/.github/commit/d7629647b3107ed34d27641f11fa068f7198005a))
* **well-known:** composite action skeleton + python package layout ([e0b1209](https://github.com/hop-top/.github/commit/e0b1209d8bf552fc60390a891e07343f6ffa7cf6))
* **well-known:** config loader with schema, env interp and durations ([aa90b9e](https://github.com/hop-top/.github/commit/aa90b9ec535a732ebdd0496d413880caafe73c27))
* **well-known:** interpolate only allowlisted env vars ([23f8439](https://github.com/hop-top/.github/commit/23f8439bd361697067084286f9b38b025626ec01))
* **workflows:** opt-in target versioning in `release-please-on-push` ([67088f3](https://github.com/hop-top/.github/commit/67088f3f9ed0b260b29d97e06f2ea455544c09c0))


### Bug Fixes

* packages without extra-files take the top-level list ([0423c38](https://github.com/hop-top/.github/commit/0423c389305e08a4f96f1dcd54a3f8c95c9fc77e))
* **preflight:** check target records against the manifest on next only ([8ef8492](https://github.com/hop-top/.github/commit/8ef849251015efc64a2c3fdf55b2374fb4ec64c0))
* **preflight:** check typed extra-files by their updater's rules ([0aebc52](https://github.com/hop-top/.github/commit/0aebc52786432f5dc96b5433ce6e9a09b57bcaf7))
* **preflight:** fail a TOML extra-file value that is not a string ([faa8402](https://github.com/hop-top/.github/commit/faa84020dfa766c26d1ae87883ef4a54ace6947e))
* **preflight:** first-release release-as pin is not stale ([6f34ed7](https://github.com/hop-top/.github/commit/6f34ed7a03d6040a7eaf3573cce4c366d000909f))
* **preflight:** look up nested modules among tracked files ([17da1b6](https://github.com/hop-top/.github/commit/17da1b6d5854895f1eb05501fa484b23070b9326))
* **preflight:** match release-please on extra-files edge cases ([9efeaa9](https://github.com/hop-top/.github/commit/9efeaa9100fa79244360e37a5515261fe524f018))
* **preflight:** null bump options fall back to the top level ([71a87d7](https://github.com/hop-top/.github/commit/71a87d76e636e3e19dbbe1bbff2a63fa7c5b2387))
* **preflight:** point fix hints at doc sections that exist ([17c5ae6](https://github.com/hop-top/.github/commit/17c5ae669c4c07fad5851d0fd09359f63cdbb607))
* **preflight:** read prerelease options with top-level fallback ([769b53d](https://github.com/hop-top/.github/commit/769b53d2cc9d2eda63510b9590b7920b5d196b90))
* **preflight:** read xpath for xml extra-files, jsonpath for the rest ([be3eb1a](https://github.com/hop-top/.github/commit/be3eb1a7abd6957e107f9b652a19056c9f9b71f5))
* **preflight:** refuse target seeds off alpha/beta/rc channels ([c3aca42](https://github.com/hop-top/.github/commit/c3aca42b0296448921b5abae1d609797b4f233e2))
* **release-please-on-push:** refuse a tooling-ref that is not one ref ([f8fe85a](https://github.com/hop-top/.github/commit/f8fe85a16145b1fc3c30e58f13b6888b43ac5f6c))
* **release-please-target:** before 1.0 means the family's highest is 0.x ([1ac8e8d](https://github.com/hop-top/.github/commit/1ac8e8dd3a74905300bf948fa334d04350fe4b79))
* **release-please-target:** block a first release below the family line ([1305360](https://github.com/hop-top/.github/commit/130536020cc031dd1c5e76bea50809f6eebb2c71))
* **release-please-target:** cut promotions at once, skip non-rc packages ([9608185](https://github.com/hop-top/.github/commit/96081858a563bd43d69ddc22effc0fda2619ec1d))
* **release-please-target:** group promotion skips members already there ([c293738](https://github.com/hop-top/.github/commit/c2937382c878c82de15921f7fec0ef91a8ede330))
* **release-please-target:** link a pre-1.0 minor at any patch on main ([6f15cce](https://github.com/hop-top/.github/commit/6f15cce82e8ae7fc3aad4098768116326e290674))
* **release-please-target:** link pre-1.0 minors on the stable branch ([9e2fa1c](https://github.com/hop-top/.github/commit/9e2fa1c2c887f02f2a8d2519d83f0f9db10ca66e))
* **release-please-target:** linked next target from linked lines only ([2fe0d34](https://github.com/hop-top/.github/commit/2fe0d34cead5828a4057707ebae3dac8d4d70ff3))
* **release-please-target:** linked stable target from linking members ([693094a](https://github.com/hop-top/.github/commit/693094afc8ab7c59907aa76f0e90097f439d6a21))
* **release-please-target:** measure no-stable members from family stable ([db63e14](https://github.com/hop-top/.github/commit/db63e149a75711e11148065286304f7e8d26cd97))
* **release-please-target:** name a member past the group target ([ad9a1fe](https://github.com/hop-top/.github/commit/ad9a1fe8516da04af7a038d9525d55ee49c919f4))
* **release-please-target:** no 1.0 from a linked member's first release ([1eacb61](https://github.com/hop-top/.github/commit/1eacb61211e75ce647f10ff85d74924a06bf426c))
* **release-please-target:** note the group version only when it links ([f21cb4f](https://github.com/hop-top/.github/commit/f21cb4f4f8fe91b61291079e7d80f78fc4eacae8))
* **release-please-target:** open-line --group leaves members on the line ([0235163](https://github.com/hop-top/.github/commit/023516340330f52dd6c6b4b2ac3fd1cea1c43908))
* **release-please-target:** patch-only main, block a released rc ([3546300](https://github.com/hop-top/.github/commit/354630098ddee9bd997dc8901728bafd335aad08))
* **release-please-target:** promote steps from the released channel ([38e4b8e](https://github.com/hop-top/.github/commit/38e4b8e8dd2e6943af79ba487ff7d9821a73ff7e))
* **release-please-target:** refuse unknown manifest channels ([8ff3e8e](https://github.com/hop-top/.github/commit/8ff3e8e69453067b12f08cc895a0bae6787576c5))
* **release-please-target:** skip unreleased packages off prerelease ([ca9d77d](https://github.com/hop-top/.github/commit/ca9d77da5efbcf6d94d5c6ead203e9a61a972f98))
* **release-please-target:** start a new member on the family's line ([2378dd8](https://github.com/hop-top/.github/commit/2378dd8417cfa9476ce75f2318e51e13cfd0b3fc))
* **release-please-target:** summary shows a blocked package's block only ([d7be95e](https://github.com/hop-top/.github/commit/d7be95e8e9bdcfb31d149cc5682e49d6641b32a7))
* **release-please-target:** warn on a channel step behind the family ([c6261e6](https://github.com/hop-top/.github/commit/c6261e6832cbc71e72574433fb1a8650ae2e6616))
* **roll-major-tag:** move the major tag on stable tags only ([8dc2878](https://github.com/hop-top/.github/commit/8dc28786fcc04b3d8db6e086d5e0a0e901708eaf))
* **roll-major-tag:** treat leading-zero tags as not stable ([e2049a7](https://github.com/hop-top/.github/commit/e2049a79e2a3503afc4c4d4b2c9fe5c634fa130e))
* **version-check:** accept a plain structured entry's default path ([c714210](https://github.com/hop-top/.github/commit/c714210d06b2e9a2d48c5a95495e9a32d851d55a))
* **version-check:** exempt a JSON selector only on a version string ([fed7d2f](https://github.com/hop-top/.github/commit/fed7d2f0b9af93aa0b5035c78a5229fddc1eb6b8))
* **version-check:** exempt only the selector's line from literal rule ([b5e90c6](https://github.com/hop-top/.github/commit/b5e90c67d36b812e8a224cc1173d373a1ab2270c))
* **version-check:** match XML xpath names per namespace ([9f20158](https://github.com/hop-top/.github/commit/9f20158bcdcebfd946b903dcecce27ae32c92a03))
* **version-check:** type YAML scalars as js-yaml 4.3.2 does ([443d0e8](https://github.com/hop-top/.github/commit/443d0e85f2cde7dfb83127183271a722ba06143b))
* **version-check:** typed extra-files need no annotation ([3691b3b](https://github.com/hop-top/.github/commit/3691b3b7eaeb53c49ede876ee5b58d1546d33b0a))
* **well-known:** keep custom paths inside the output dir ([dd46d99](https://github.com/hop-top/.github/commit/dd46d99249c01a3eb2a9e1bbe05d3b45a5f27c40))
* **well-known:** percent-encode workflow command annotations ([954c2bc](https://github.com/hop-top/.github/commit/954c2bc8c93b99854d2f8159066798c35b28acbd))
* **well-known:** run the generator in a private, hash-pinned venv ([e6e088c](https://github.com/hop-top/.github/commit/e6e088c2dd933b49bae314f2b788531fdeb89d86))
* **well-known:** run venv and pip with python -P ([f33436d](https://github.com/hop-top/.github/commit/f33436d5122b662c4faf2fe23abe1b6482d3102d))
* **well-known:** source line numbers and output dir precedence ([ea4c717](https://github.com/hop-top/.github/commit/ea4c717ed608ced4db2c628435f119e18b378cd6))
* **workflows:** mint release-bot token via client-id ([054d9cb](https://github.com/hop-top/.github/commit/054d9cb1f9aaa372b681e9cf21e4d4ec4f1b5c1f))


### Refactoring

* **preflight:** read check 4b options through pkg_opt ([65d2f8c](https://github.com/hop-top/.github/commit/65d2f8c6183ece8641f1c498891c620d4106dca0))
* **version-check:** read YAML targets with PyYAML ([ebc47b3](https://github.com/hop-top/.github/commit/ebc47b3b70e732b00948ad8ec002a1fe7c5fc813))
* **version-check:** split rules and tests under 500 lines ([2a20c44](https://github.com/hop-top/.github/commit/2a20c4423af419bcd9adb422f6c1976a7a197d2a))

## [0.14.1](https://github.com/hop-top/.github/compare/v0.14.0...v0.14.1) (2026-10-11)


### Bug Fixes

* **preflight:** accept multi-module Go repos without `publish.yml` ([25770b6](https://github.com/hop-top/.github/commit/25770b641ea2983395e9f6586b1543f552fa29d5))
* **preflight:** allow nested components for Go-only repos ([a2d10d8](https://github.com/hop-top/.github/commit/a2d10d8615a0a719845c994c3656cadce3974962))

## [0.14.0](https://github.com/hop-top/.github/compare/v0.13.1...v0.14.0) (2026-09-30)


### Features

* **preflight:** accept `release-please-on-push` callers ([9c58457](https://github.com/hop-top/.github/commit/9c5845741883746ecd24118b241fe9bb1ef4fafe))
* **workflows:** reusable `release-please-on-push` with per-branch concurrency guard ([006b2dd](https://github.com/hop-top/.github/commit/006b2dd4d07e1910b9cae26c04a8e6b34ae84e1a))
* **workflows:** skip `release-please-on-push` in repos without release-please config ([590d791](https://github.com/hop-top/.github/commit/590d7917e660df4e7d32634043be16eb20f6c25a))

## [0.13.1](https://github.com/hop-top/.github/compare/v0.13.0...v0.13.1) (2026-09-29)


### Bug Fixes

* **preflight:** resolve root-relative `extra-files` paths ([7dd0e99](https://github.com/hop-top/.github/commit/7dd0e996a118ce004fd9c10e73cfc8c0728049d2))
* **spec-versioning:** resolve root-relative `extra-files` paths in version-check ([d849596](https://github.com/hop-top/.github/commit/d84959661d90c10a3b4fb6f3d3b4db80c49bb14e))

## [0.13.0](https://github.com/hop-top/.github/compare/v0.12.0...v0.13.0) (2026-09-16)


### Features

* **preflight:** check spec packages and extra-files targets ([4ad4d16](https://github.com/hop-top/.github/commit/4ad4d16637e4295c43bef4ec6182000b199d6803))
* **spec-versioning:** reusable spec-commit-rules, spec-status-line and version-check workflows ([12fef6e](https://github.com/hop-top/.github/commit/12fef6e906e1b29521201470e2aa9af919c92c61))
* **spec-versioning:** share the spec commit rules, status-line and version-check scripts ([832be4e](https://github.com/hop-top/.github/commit/832be4e7c1eeb7c37254d91ddcbc5a5441b0417b))

## [0.12.0](https://github.com/hop-top/.github/compare/v0.11.3...v0.12.0) (2026-09-09)


### Features

* **mirror:** optional target-prefix for grafted mirror publish ([0cfb33f](https://github.com/hop-top/.github/commit/0cfb33ff1e223ea7d6bed9311bf588653612a8b9))
* **mirror:** optional target-prefix for grafted mirror publish ([350980d](https://github.com/hop-top/.github/commit/350980dacf6375518cf3eb72074a09606f9e8841))

## [0.11.3](https://github.com/hop-top/.github/compare/v0.11.2...v0.11.3) (2026-08-30)


### Bug Fixes

* **release-tag-on-merge:** tolerate losing the tag race ([#68](https://github.com/hop-top/.github/issues/68)) ([c41e4c3](https://github.com/hop-top/.github/commit/c41e4c3cba152124f75ec0f090c14a4aca613310))

## [0.11.2](https://github.com/hop-top/.github/compare/v0.11.1...v0.11.2) (2026-08-30)


### Bug Fixes

* **preflight:** root aggregate component may be absent from ecosystems ([#65](https://github.com/hop-top/.github/issues/65)) ([2f49568](https://github.com/hop-top/.github/commit/2f495681239f682c6c3ccec33bed952b4af7f392))

## [0.11.1](https://github.com/hop-top/.github/compare/v0.11.0...v0.11.1) (2026-08-30)


### Bug Fixes

* **workflows:** publish-on-tag hardening + umbrella support ([#54](https://github.com/hop-top/.github/issues/54)) ([f654b72](https://github.com/hop-top/.github/commit/f654b72ba46804c68b65f621334fcebae36350e3))

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

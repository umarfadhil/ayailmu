package curriculum

// Embedded registry data. Every pack fact here (SHA-256 of the exact file bytes, synthetic flag,
// answer_format, meta.schema_version, review_status counts over items and lesson screens, and note) is
// copied verbatim from the pack file; curriculum_test.go recomputes each one from the files. Expo packs
// live in ayailmu-publish, Android packs in this repository. ReviewedProductionContent is derived by
// newRegistry, never written here.
//
// demo-synthetic-0.3 is pinned to the frontend's authoritative bytes at 8b29a91a2ae4a83d89cbfbfe58c8fdfa67670923
// (SHA-256 80eb638a...). It was first pinned to the bytes at ef28606 (af0c4bdd...). The only difference is three
// lesson-screen copy strings (frontend 7f5d9a7); the 45 items, ids, choices, keys, content_version and the 53 draft
// statuses are identical. The source SHA-256 is metadata served by GET /v1/curricula; the registry key, the envelope's
// semantic hash and every stored column are independent of it, so events recorded against either bytes stay valid and
// registered. infra/catalog/verify_alignment_proof.py proves the bounded difference and source_alignment_test.go pins the
// unchanged event identity; the historical ef28606 bytes stay archived in infra/catalog/pinned-expo-fixtures.

var registeredFamilies = []Family{
	{Name: "android-catalog", App: "android", Schema: "kotlin.answer_event", SchemaVersions: []int{1}, ApprovedReviewStatus: "approved"},
	{Name: "expo-trial-arabic", App: "expo", Schema: "expo.answer_record", SchemaVersions: []int{1, 2}, ApprovedReviewStatus: "approved-for-trial"},
}

var registeredPacks = []Pack{
	{
		Family: "expo-trial-arabic", Track: "arab", ContentVersion: "demo-synthetic-0.1", Lifecycle: LifecycleLegacy,
		Source: PackSource{
			Repo:   "ayailmu-publish",
			Path:   "app/src/content/fixtures/demo-unit-a.json",
			SHA256: "34013947405d765e11d44baa7830c620ae417b90d24dbc845fca95625f2ac44e",
			Format: "expo-content-pack",
		},
		Synthetic:          true,
		ReviewStatusCounts: map[string]int{"draft": 20},
		Note:               "SYNTHETIC DEVELOPER FIXTURE. Unreviewed constructed sentences modelled on Lessons_Unit_A_B_Draft.md (draft). Not approved for trial. IDs are DEMO-* so they never collide with real item IDs.",
	},
	{
		Family: "expo-trial-arabic", Track: "arab", ContentVersion: "demo-synthetic-0.2", Lifecycle: LifecycleLegacy,
		Source: PackSource{
			Repo:         "ayailmu-publish",
			Path:         "app/src/content/fixtures/demo-v0.2.json",
			SHA256:       "be4f8038fd71b56266ca257aae9d0fdf0b9110d220a968bf98adc05f57af7a02",
			Format:       "expo-content-pack",
			AnswerFormat: "mcq4",
		},
		Synthetic:          true,
		ReviewStatusCounts: map[string]int{"draft": 50},
		Note:               "SYNTHETIC DEVELOPER FIXTURE (four-choice). Unreviewed constructed material modelled on Lessons_Unit_A_B_Draft.md. Not approved for trial. See docs/Four_Choice_Content_Review.md.",
	},
	{
		Family: "expo-trial-arabic", Track: "arab", ContentVersion: "demo-synthetic-0.3", Lifecycle: LifecycleActive,
		Source: PackSource{
			Repo:         "ayailmu-publish",
			Path:         "app/src/content/fixtures/demo-v0.3.json",
			SHA256:       "80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee",
			Format:       "expo-content-pack",
			AnswerFormat: "mcq4",
		},
		Synthetic:          true,
		ReviewStatusCounts: map[string]int{"draft": 53},
		Note:               "SYNTHETIC DEVELOPER FIXTURE (four-choice, repair 2026-10-16). Unreviewed constructed material modelled on Lessons_Unit_A_B_Draft.md. Not approved for trial. See docs/Four_Choice_Content_Review.md.",
	},
	{
		Family: "android-catalog", Track: "arab", ContentVersion: "demo-synthetic-0.1", Lifecycle: LifecycleActive,
		Source: PackSource{
			Repo:              "ayailmu",
			Path:              "android/content/src/main/assets/packs/bahasa/arab/v1.json",
			SHA256:            "94a879edd88c69a4beaf1ebca34dfb17c0ab473e063441dbfe1cb4ecbb665a10",
			Format:            "android-pack",
			MetaSchemaVersion: 1,
		},
		Synthetic:          true,
		ReviewStatusCounts: map[string]int{"draft": 20},
		Note:               "SYNTHETIC DEVELOPER FIXTURE converted from prototype-expo/src/content/fixtures/demo-unit-a.json. Unreviewed constructed sentences modelled on Lessons_Unit_A_B_Draft.md (draft). Not approved. IDs are DEMO-* so they never collide with real item IDs.",
	},
	{
		Family: "android-catalog", Track: "mat", ContentVersion: "mat-sample-0.2", Lifecycle: LifecycleActive,
		Source: PackSource{
			Repo:              "ayailmu",
			Path:              "android/content/src/main/assets/packs/matematika/mat/v1.json",
			SHA256:            "ae93ba089a1526314070c6e771133060a9653705daf626a39fc16949573970ce",
			Format:            "android-pack",
			MetaSchemaVersion: 1,
		},
		Synthetic:          true,
		ReviewStatusCounts: map[string]int{"draft": 13},
		Note:               "12-item developer sample exercising casual mode and the v1 renderer types in both languages (docs/syllabus/02_MATEMATIKA.md, Kids Pemula unit 1). Draft until a math reviewer and both language reviewers approve. Images are placeholders until P4.",
	},
}

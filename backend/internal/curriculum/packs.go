package curriculum

// Embedded registry data. Every pack fact here (SHA-256 of the exact file bytes, synthetic flag,
// answer_format, meta.schema_version, review_status counts over items and lesson screens, and note) is
// copied verbatim from the pack file; curriculum_test.go recomputes each one from the files. Expo packs
// live in ayailmu-publish, Android packs in this repository. ReviewedProductionContent is derived by
// newRegistry, never written here.

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
			SHA256:       "af0c4bdd7b1db1cc188259dc7ebf484207773cd0657e66b5ec379c6f4fa71cf5",
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

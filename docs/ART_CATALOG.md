# Art catalog — AyaIlmu (P4 draft set)

Status: **DRAFT art, IN SOURCE (2026-10-17; picture vocabulary added 2026-10-18, 309 keys)**. Every key below is drawn by Claude as hand-authored vector code
(ART_DIRECTION §6) and ships only as a placeholder until a human illustrator redraws or approves it against
ART_DIRECTION §7. Packs may reference **only** these keys; `validatePacks` checks them against
`android/content/src/main/assets/art/index.json`, which the art tool writes.

- Tool: `art/tools/draw.py` (Python 3, no network). One run writes, per key: an SVG preview in `art/preview/`,
  an Android VectorDrawable `android/core/design/src/main/res/drawable/art_<key>.xml`, `assets/art/index.json`
  and `core/design/.../ArtRegistry.kt` (key → drawable id).
- Colours are colour resources (`@color/art_ink`, `art_paper`, `art_clay`, `art_ochre`, `art_sage`, `art_slate`,
  `art_blush`) with night variants, so drawings stay readable on night paper. Never hard-coded hex in drawables.
  One exception, for the ten `pic_color_*` daubs only: the learning colours `art_learn_red`, `_blue`, `_yellow`,
  `_green`, `_black`, `_white`, `_orange`, `_purple`, `_brown`, `_pink` (light and night), written by the tool to
  `res/values(-night)/art_learn_colors.xml` from `LEARN` in `draw.py`.
- Viewports: square keys 240×240; scenes and covers 400×300 (4:3); `body_child` 300×400 (3:4);
  `map_indonesia` 400×200 (2:1). Regions are fractions of the picture (x, y, w, h; origin top-left).

## Characters and app chrome

| Key | What |
|---|---|
| `aya_idle`, `aya_wave`, `aya_happy`, `aya_think`, `aya_sleep` | **Aya**, the coach: a small round seedling with a two-leaf sprout (ilmu that grows), dot eyes, small mouth, stub arms. Draft design until the illustrator's style bible defines Aya. |
| `cover_bahasa`, `cover_matematika`, `cover_sains`, `cover_sosial_seni` | Subject covers (4:3): open book + speech curl; counting beads + ruler; sprout + magnifying glass; angklung + brush. No letters or digits drawn. |
| `glyph_correct`, `glyph_not_yet`, `glyph_saved` | Feedback glyphs (small, 2 weights): a drawn tick; a looping "let's look" arrow; a small notebook. |
| `glyph_listen`, `glyph_drag`, `glyph_trace`, `glyph_connect` | Interaction glyphs (same family: broad offset colour stroke under an ink line): a speaker with two sound arcs (listen / play audio); a pointing hand with a short arrow (drag); a pencil drawing along a dotted line (trace); two dots joined by a wobbly line (connect / match). |
| `state_error`, `state_seedling`, `state_survey` | Calm states: a loose knot of thread; a seed in a clay pot; a clipboard with three tick boxes (two ticked, one empty) and a pencil pointing at the empty one, header for the trial survey (squiggles, no letters or digits). |
| `gem`, `gem_box` | A cut gem (permata) with hatching; a small wooden box. |
| `app_icon_draft` | Aya silhouette on paper for the launcher (draft). |
| `app_icon_mono` | Monochrome (themed icon) launcher layer: Aya's idle silhouette as one flat ink shape, eyes cut out as holes; no paper, grain or second colour. Fills about 70% of the height and stays inside the safe zone after the 16% inset. |

## Stickers (one per unit, awarded when the unit is done)

`sticker_mango`, `sticker_kite`, `sticker_angklung`, `sticker_bicycle`, `sticker_teapot`, `sticker_cat`,
`sticker_star_fruit`, `sticker_boat`, `sticker_lantern`, `sticker_leaf`, `sticker_shell`, `sticker_rice_field`,
`sticker_drum`, `sticker_umbrella`, `sticker_book`, `sticker_compass`.

`plot_seed`: what an unfinished unit shows in its `scene_garden` bed until the sticker is earned: one small soil pile
with a two-leaf sprout just breaking through (not Aya, no face). Heavy contour and big leaves so it reads at 40 dp;
drawn low in the frame so it sits over the bed.

## Pictures for questions

| Keys | What |
|---|---|
| `count_mango_1` … `count_mango_20` | 1–20 mangoes, loosely arranged in rows of five (easy to count). |
| `count_egg_1` … `count_egg_20` | 1–20 eggs, same layout. |
| `count_marble_1` … `count_marble_20` | 1–20 marbles (kelereng), same layout. |
| `groups_<g>x<n>` for g, n ∈ {2,3,4,5} | g circled groups with n marbles each (equal groups for ×/÷). |
| `shape_circle`, `shape_square`, `shape_triangle`, `shape_rectangle`, `shape_oval`, `shape_rhombus` | Flat shapes. |
| `solid_cube`, `solid_cuboid`, `solid_cylinder`, `solid_cone`, `solid_sphere`, `solid_pyramid` | Solids, hatched side. |
| `clock_<h>_<mm>` for h = 1…12, mm ∈ {00, 30} | Clock faces, e.g. `clock_3_00`, `clock_7_30`. Tick marks only, no digits. |
| `frac_1_2`, `frac_1_3`, `frac_2_3`, `frac_1_4`, `frac_3_4`, `frac_1_8` | A round cake with that fraction hatched. |
| `balance_left_heavy`, `balance_right_heavy`, `balance_even` | A two-pan balance scale. |
| `length_short`, `length_medium`, `length_long` | A pencil of three lengths over the same baseline. |
| `pos_cat_above`, `pos_cat_below`, `pos_cat_left`, `pos_cat_right`, `pos_cat_inside` | A cat and a box (position words). |
| `sense_eye`, `sense_ear`, `sense_nose`, `sense_tongue`, `sense_hand` | The five senses. |
| `wash_hands`, `sleep_moon`, `drink_water`, `toothbrush` | Healthy habits. |
| `fam_grandmother`, `fam_grandfather`, `fam_mother`, `fam_father`, `fam_sister`, `fam_brother`, `fam_baby` | Family members (kind, simple figures; the mother wears a kerudung). |
| `fruit_mango`, `fruit_banana`, `fruit_rambutan`, `fruit_papaya` | Fruit for pictographs and sorting. |
| `coin_generic`, `note_generic` | Money without denominations or national emblems (amounts stay in text). |

## Picture vocabulary (`pic_*`, INTERACTIONS_AUDIO §5) — DRAFT 2026-10-18

114 pictures shared by every language track (plus the four interaction glyphs above). One object or one figure per
picture, 240 × 240, no regions. People come from one posable figure in `draw.py` built like `fam_*` (same face, hair,
skin recipe), with varied skin tones (light / mid / deep), ages and clothing; a kerudung on some women and girls, not
all. No letters or digits anywhere (chalkboard marks are shapes, `pic_sleep`'s "z" marks are zigzags as in `aya_sleep`).
Illustrator brief: `art/briefs/vocabulary-set.md`.

**People & greetings**

| Key | What |
|---|---|
| `pic_boy` | A boy (about 8) standing: clay T-shirt with a pale band, slate shorts, short dark hair. |
| `pic_girl` | A girl standing: sage dress with a pale collar, dark ponytail with an ochre tie. |
| `pic_man` | A man standing: slate collared shirt, khaki (ochre) trousers. |
| `pic_woman` | A woman standing: long-sleeved ochre blouse, long clay skirt, dark hair in a bun (no headscarf). |
| `pic_friends` | Two children holding hands and smiling: a boy, and a girl in a kerudung. |
| `pic_teacher` | A teacher (woman in a kerudung) holding a book and pointing at a small chalkboard on an easel (chalk triangle, circle, squiggle). |
| `pic_doctor` | A doctor in a white coat, glasses and stethoscope; a small plain green plus on the pocket (never the Red Cross emblem). |
| `pic_wave_hello` | Hello: a child facing us, smiling, one open hand raised high, two motion arcs. |
| `pic_wave_bye` | Goodbye: a child walking away to the right, looking back over the shoulder and waving; a dotted trail behind. |
| `pic_thanks` | Thank you: palms pressed together at the chest, eyes closed in a smile, head bowed a little (neutral across Indonesia, Japan, Korea). |
| `pic_sorry` | Sorry: a hand at the back of the head, shy sideways glance and smile, blush, a small sweat drop. |
| `pic_yes_nod` | Yes: a smiling child nodding; two curved arrows beside the head show the downward nod. |

**Colours** — `pic_color_red`, `pic_color_blue`, `pic_color_yellow`, `pic_color_green`, `pic_color_black`,
`pic_color_white`, `pic_color_orange`, `pic_color_purple`, `pic_color_brown`, `pic_color_pink`: one wide brush stroke of
that colour on paper (a swatch with a soft start, a dry split end and one drip), flat, no gloss. The only pictures in a
learning colour (`art_learn_*`); white has a full ink edge and ink bristle lines so it shows on paper.

**Food & drink**

| Key | What |
|---|---|
| `pic_rice_bowl` | A clay bowl heaped with white rice. |
| `pic_noodle_bowl` | A bowl of noodles with egg and greens, chopsticks lifting a few noodles. |
| `pic_bread` | A loaf of bread with one slice in front. |
| `pic_egg_fried` | A fried egg (telur ceplok) on a plate. |
| `pic_apple` | One red apple with a leaf. |
| `pic_orange_fruit` | An orange (jeruk) with a leaf, and a cut half showing the segments. |
| `pic_watermelon` | A half-moon slice of watermelon with seeds. |
| `pic_fish_dish` | Fried fish on a plate with a lime wedge and cucumber slices. |
| `pic_chicken_dish` | Two pieces of fried chicken on a lettuce leaf on a plate. |
| `pic_vegetables` | A cabbage, a carrot and a tomato. |
| `pic_soup` | A bowl of vegetable soup with a spoon, steaming. |
| `pic_tea_cup` | A cup of tea on a saucer, a tea-bag tag over the rim, steam. |
| `pic_coffee_cup` | A mug of dark coffee, steam, two coffee beans. |
| `pic_milk_glass` | A glass of white milk on a soft sage backdrop (so the white reads on paper). |
| `pic_juice` | A glass of orange juice with a striped straw and an orange slice on the rim. |
| `pic_cake` | A round layered cake with cream and strawberries on a stand. |
| `pic_kimchi` | A small dish of kimchi: red-coated cabbage pieces, chili flakes. |
| `pic_onigiri` | A triangular rice ball with a nori band, on a banana leaf. |
| `pic_dumplings` | Three pleated dumplings (jiaozi) on a plate, a small dish of dipping sauce. |
| `pic_chopsticks` | A pair of chopsticks on a chopstick rest. |
| `pic_spoon_fork` | A spoon and a fork on a napkin (the Indonesian table set). |

**Animals**

| Key | What |
|---|---|
| `pic_cat` | An orange tabby cat walking, tail up, face turned to us. |
| `pic_dog` | A brown dog with floppy ears and a collar, tail wagging. |
| `pic_bird` | A small bird perched on a branch. |
| `pic_fish` | A live fish swimming, a few bubbles. |
| `pic_cow` | A brown cow with white socks and rump (like a Bali cow), short horns, face turned to us. |
| `pic_chicken` | A hen with a red comb. |
| `pic_rabbit` | A grey rabbit sitting, long ears up. |
| `pic_horse` | A brown horse standing, dark mane and tail. |
| `pic_goat` | A white goat with brown patches, small horns and a beard. |
| `pic_duck` | A white duck swimming. |
| `pic_elephant` | A grey elephant, trunk curled. |
| `pic_monkey` | A monkey sitting with a banana, tail curled. |

**Things at home & school**

| Key | What |
|---|---|
| `pic_house` | A house with a tiled roof, a door and two windows with open shutters. |
| `pic_school` | A school: a long low building with a row of windows, a door under a blank sign, a flagpole with a plain red-over-white flag. |
| `pic_book` | A closed book with a blank label and a ribbon bookmark. |
| `pic_pen` | A ballpoint pen with cap and clip, and the short line it drew. |
| `pic_pencil` | A sharpened pencil with an eraser. |
| `pic_bag` | A school backpack. |
| `pic_table` | A wooden table. |
| `pic_chair` | A wooden chair. |
| `pic_door` | A wooden door standing ajar in its frame, a doormat. |
| `pic_window` | A window with open wooden shutters, sky and a cloud, a plant on the sill. |
| `pic_bed` | A bed with a pillow and a blanket (nobody in it). |
| `pic_phone` | A mobile phone with a few app squares (no logo). |
| `pic_ball` | A football (soccer ball). |
| `pic_shoes` | A pair of sneakers. |
| `pic_shirt` | A T-shirt with a pocket. |
| `pic_hat` | A cap (topi). |

**Places & transport**

| Key | What |
|---|---|
| `pic_market` | A market stall with a striped awning and baskets of fruit and vegetables. |
| `pic_hospital` | A hospital building with a sign showing a plain green plus (not the Red Cross emblem). |
| `pic_park` | A park: a tree, a bench, grass and a path. |
| `pic_station` | A station: a train front at a platform under a roof. |
| `pic_car` | A car, side view. |
| `pic_bus` | A bus, side view. |
| `pic_train` | A train on rails, side view. |
| `pic_motorbike` | A scooter-style motorbike (motor matic), side view. |
| `pic_bicycle` | A bicycle with a front basket. |
| `pic_plane` | An aeroplane flying, a small cloud. |
| `pic_ship` | A ship with a funnel on the sea. |

**Nature & weather**

| Key | What |
|---|---|
| `pic_sun` | The sun with rays (no face). |
| `pic_rain` | A grey cloud with falling drops. |
| `pic_cloud` | A white cloud on a pale sky patch. |
| `pic_rainbow` | A rainbow (four muted bands) between two small clouds. |
| `pic_tree` | A leafy tree with a few fruits. |
| `pic_flower` | One flower: five petals, stem and two leaves. |
| `pic_mountain` | A mountain with a rocky peak and a path. |
| `pic_sea` | The sea: waves out to the horizon, the sun on the horizon. |
| `pic_star` | A five-pointed star. |

**Actions**

| Key | What |
|---|---|
| `pic_eat` | A child eating rice from a bowl with a spoon. |
| `pic_drink` | A child drinking from a glass of water. |
| `pic_sleep` | A child asleep on a mattress under a blanket, zigzag "z" marks. |
| `pic_read` | A girl in a kerudung reading an open book. |
| `pic_write` | A child at a desk writing in a notebook with a pencil. |
| `pic_walk` | A child walking, side-on, mid-stride. |
| `pic_run` | A child running: lean, one foot up, speed lines. |
| `pic_play` | A child kicking a ball. |
| `pic_sing` | A child singing, eyes closed, mouth open, music notes. |
| `pic_cook` | A man in an apron stirring a wok on a stove, steam. |
| `pic_swim` | A child swimming: up to the chest in water, goggles on the forehead, hands at the surface (never a lone hand above water). |
| `pic_sit` | A child sitting on a wooden stool, hands on knees. |

**Feelings & describing**

| Key | What |
|---|---|
| `pic_happy` | A child beaming, eyes closed in a smile, both open hands raised. |
| `pic_sad` | A child with a down-turned mouth and a tear, head lowered. |
| `pic_tired` | A child yawning, eyes closed, a hand by the mouth. |
| `pic_hot` | Too hot: sweat drops, flushed cheeks, fanning with a hand fan, the sun in the corner. |
| `pic_cold` | Cold: arms hugging the body, a scarf, shiver marks and wind lines. |
| `pic_big` | A big ball next to a small sitting cat (the same cat, same size, as in `pic_small`). |
| `pic_small` | A small ball next to the same cat. |
| `pic_hungry` | A child with a hand on the tummy, thinking of a bowl of rice (thought bubble). |

**Body**

| Key | What |
|---|---|
| `pic_head` | A child's head and neck, front view. |
| `pic_mouth` | A smiling mouth showing teeth. |
| `pic_foot` | A bare foot seen from above, five toes with nails. |

## Scenes with tap regions (`tap_hotspot`) — copy the regions exactly

`scene_kampung_shapes` (400×300): a house, the sun, a kite and a noticeboard.

| Hotspot | x | y | w | h |
|---|---|---|---|---|
| sun (circle) | 0.06 | 0.06 | 0.18 | 0.24 |
| roof (triangle) | 0.30 | 0.20 | 0.36 | 0.22 |
| wall (square) | 0.34 | 0.44 | 0.28 | 0.37 |
| kite (rhombus) | 0.74 | 0.06 | 0.16 | 0.26 |
| board (rectangle) | 0.72 | 0.56 | 0.22 | 0.18 |

`body_child` (300×400): a child standing, front view.

| Hotspot | x | y | w | h |
|---|---|---|---|---|
| eyes | 0.36 | 0.10 | 0.28 | 0.07 |
| nose | 0.45 | 0.175 | 0.10 | 0.05 |
| mouth | 0.42 | 0.235 | 0.16 | 0.05 |
| ear | 0.24 | 0.11 | 0.09 | 0.10 |
| hand | 0.06 | 0.46 | 0.14 | 0.10 |
| foot | 0.54 | 0.89 | 0.20 | 0.08 |

`map_indonesia` (400×200): the main island groups, stylised (draft, not a survey map).

| Hotspot | x | y | w | h |
|---|---|---|---|---|
| sumatra | 0.02 | 0.05 | 0.22 | 0.55 |
| jawa | 0.24 | 0.62 | 0.20 | 0.14 |
| kalimantan | 0.28 | 0.08 | 0.20 | 0.40 |
| sulawesi | 0.50 | 0.20 | 0.14 | 0.40 |
| bali_nusa_tenggara | 0.45 | 0.78 | 0.22 | 0.12 |
| maluku | 0.66 | 0.25 | 0.10 | 0.35 |
| papua | 0.77 | 0.25 | 0.22 | 0.45 |

`scene_garden` (400×300): "Kebun Ilmu", the calm progress garden: sun and one cloud top-left, a soft hill line, a
low bamboo fence (pagar bambu) on the horizon and ten empty tilled soil beds (bedengan) in two rows. These regions are
**placement slots, not tap targets**: the app centres a sticker (unit done) or `plot_seed` (unit not done) in each.
Every bed is drawn in the bottom third of its region, so the upper part stays free; the front row is larger.

| Plot | x | y | w | h |
|---|---|---|---|---|
| plot_01 | 0.07 | 0.42 | 0.14 | 0.18 |
| plot_02 | 0.25 | 0.42 | 0.14 | 0.18 |
| plot_03 | 0.43 | 0.42 | 0.14 | 0.18 |
| plot_04 | 0.61 | 0.42 | 0.14 | 0.18 |
| plot_05 | 0.79 | 0.42 | 0.14 | 0.18 |
| plot_06 | 0.04 | 0.66 | 0.16 | 0.22 |
| plot_07 | 0.23 | 0.66 | 0.16 | 0.22 |
| plot_08 | 0.42 | 0.66 | 0.16 | 0.22 |
| plot_09 | 0.61 | 0.66 | 0.16 | 0.22 |
| plot_10 | 0.80 | 0.66 | 0.16 | 0.22 |

## Follow-up 12, group A: covers, levels, values, science, maths, culture — DRAFT 2026-10-18

78 keys drawn as code in the drawing modules `art/tools/art_covers.py`, `art/tools/art_values.py` and
`art/tools/art_school.py` (loaded by `draw.py`). Contact sheets `art/preview/sheet_13a_fu12_covers_levels.png`,
`sheet_13b_fu12_science_maths.png`, `sheet_13c_fu12_culture.png`, `sheet_13d_fu12_values.png` (each also `*_night`).
Illustrator brief: `art/briefs/follow-up-12-group-a.md`. No letters or digits anywhere, except the hand-lettered script
that is the subject of each language cover (drawn shapes, to be checked by a native reader).

**Covers and level badges** (covers 400 × 300 like the four subject covers; badges 240 × 240, read at 40 dp)

| Key | What |
|---|---|
| `cover_nilai` | Nilai: an adult's hand from the right offers a mango on its open palm; a child's smaller hand from the lower left reaches up to receive it (berbagi). Hands only, two skin tones. |
| `cover_sejarah` | Sejarah: an hourglass beside an unrolled scroll with squiggle lines (no letters) and a round seal. |
| `cover_lang_arab` | Arabic: the letters ا ب ت (alif, ba, ta) hand-lettered right to left as brush strokes with their dots, and a glass of tea on a saucer. |
| `cover_lang_inggris` | English: hand-lettered capital A and single-storey small a, and an apple. |
| `cover_lang_korea` | Korean: the hangul syllable 한 as brush strokes, and a bowl of rice with the Korean spoon and flat chopsticks (sujeo). |
| `cover_lang_jepang` | Japanese: the hiragana あ in three brush strokes, and a folded paper crane. |
| `cover_lang_mandarin` | Mandarin: the hanzi 学 (to learn) as brush strokes, and a red paper lantern (lampion). |
| `level_pemula` | Pemula: a seedling, Aya's two leaves on a short stem, out of a small soil mound on a soft round tint. |
| `level_menengah` | Menengah: a sapling, taller stem with three pairs of Aya-style leaves, same mound and tint. |
| `level_mahir` | Mahir: a young tree, slim trunk with two branches and a round crown made of Aya-style leaves. |
| `level_master` | Master: a fruiting tree, sturdy trunk, wide leafy crown with four mangoes. |

No flags, map outlines or landmarks on the language covers. The four badges share the mound and tint, so the ladder
reads as one plant growing.

**Values scenes** (`val_*`, 400 × 300; Nilai, MODULES_LEVELS_STORIES §3). One moment each, two or three people,
everyday Indonesian settings, people of many ages and skin tones, a kerudung on some women and girls and not on others.
The "not good" scenes are gentle: the action shows in posture and objects, nobody cries or is mocked, nothing violent,
no red or negative mark on a person.

| Key | What |
|---|---|
| `val_queue` | Antre: three people wait in line at a service window (loket), a dashed line on the floor; the girl at the front holds her coins. |
| `val_cut_queue` | Menyerobot antrean: a woman and a child wait at the loket; a boy hurries in from the side and steps in front; the woman lifts a hand, surprised. |
| `val_give_seat` | Memberi tempat duduk: in a bus a boy has stood up and shows his empty seat with an open hand to a grandmother with a walking stick. |
| `val_help_cross` | Membantu menyeberang: on a zebra crossing a girl walks an elderly man (peci, stick) across, arm in arm. |
| `val_say_thanks` | Berterima kasih: an aunt hands a boy a wrapped gift; he takes it with both hands, head bowed a little, smiling. |
| `val_say_sorry` | Meminta maaf: a tipped cup and puddle; the boy who knocked it scratches the back of his head and holds out his hand; his friend smiles and reaches to shake it. |
| `val_share_food` | Berbagi: a girl in a kerudung offers a piece of kue from her open lunchbox; her friend reaches for it. |
| `val_return_wallet` | Mengembalikan dompet: a boy holds out a found wallet to the man (market bag) who dropped it; the man turns back, glad. |
| `val_return_change` | Mengembalikan kembalian: at a warung counter with jars a woman hands back an extra note; the seller (peci) is pleasantly surprised. |
| `val_tell_truth` | Berkata jujur: a broken flower pot on the floor; the boy points at it and tells his mother, who bends a little to listen. |
| `val_copy_answer` | Menyontek: two pupils in SD uniform at one desk during a test; the boy leans over, a dashed line from his eyes to his neighbour's paper; she keeps writing. |
| `val_clean_up` | Membersihkan kelas: a girl sweeps a small pile of dust with a broom; a boy puts books back on the shelf. |
| `val_throw_trash` | Membuang sampah pada tempatnya: a girl drops a wrapper into a bin; a second bin beside it. |
| `val_litter` | Membuang sampah sembarangan: a boy walks on eating a snack; the wrapper falls behind him; a bin stands close by. |
| `val_listen` | Mendengarkan: a girl talks (a bubble of squiggles); her friend faces her, attentive. Close-up busts. |
| `val_interrupt` | Memotong pembicaraan: two friends talk; a third pushes in between, hand up, mouth wide, his big spiky bubble covering theirs; the two stop, surprised. Busts. |
| `val_wait_turn` | Menunggu giliran: a girl on a swing; a boy waits beside it, hands behind his back, smiling. |
| `val_help_friend` | Menolong teman: a girl carries a tall stack of books; her friend lifts the top half off. |
| `val_include_friend` | Mengajak bermain: two children play ball; one waves a new child over with an open hand; she smiles and comes closer. |
| `val_left_out` | Dikucilkan: two children play ball together; a third sits alone on a bench at the side, watching, quiet (no tears). |
| `val_keep_promise` | Menepati janji: close up, two friends hook little fingers (pinky promise), both smiling. |
| `val_on_time` | Tepat waktu: a pupil walks through the open school gate; the gate clock (ticks, no numbers) shows a quarter to seven; the teacher waves. |
| `val_late` | Terlambat: the gate clock is past seven and the gate is closing; a pupil runs for it, bag bouncing, a sweat drop. |
| `val_borrow_return` | Mengembalikan pinjaman: a girl gives back a rolled umbrella with both hands; her friend takes it, smiling. |
| `val_gotong_royong` | Gotong royong: two neighbours carry a long bamboo pole on their shoulders; a boy helps with a bucket; a kampung roof behind. |
| `val_respect_elder` | Menghormati orang tua (salim): a girl bows and brings her grandfather's hand to her forehead; he smiles (peci, sarung). |
| `val_visit_sick` | Menjenguk teman sakit: a friend rests in bed under a blanket; a girl visits with a small basket of fruit. |
| `val_greet_neighbor` | Menyapa tetangga: behind her fence a neighbour (kerudung) waters her plants and waves; a boy on the lane waves back. |
| `val_friends_diverse` | Bersahabat dalam perbedaan: three friends side by side, smiling: a girl in a kerudung, a boy in a wheelchair with glasses, a girl with long hair. |
| `val_save_water` | Hemat air: a girl turns the tap off after brushing her teeth (cup with toothbrush); the last drop falls. |
| `val_kind_animal` | Menyayangi hewan: a boy squats and sets down a bowl of water for a cat. |
| `val_phone_kind` | Bijak bermedia: a boy sends a kind message, a bubble with a small flower from his phone; his friend smiles at her phone. Busts. |
| `val_phone_unkind` | Kurang bijak bermedia: the same two; a frowning boy sends a spiky scribble; his friend reads it and looks down, hurt (no tears). Busts. |
| `val_calm_breath` | Menenangkan diri: a girl sits cross-legged on a mat, eyes closed, a hand on her belly, breathing out (soft curls). |
| `val_angry_face` | Marah: a boy, close up, arms crossed, brows down, flushed cheeks, a small scribble cloud over his head. Nothing broken, no shouting. |
| `val_teamwork` | Bekerja sama: two children plant a young tree, one holding it straight, one shovelling soil; a watering can waits. |

Pairs meant to sit side by side as options share setting and people: `val_queue` / `val_cut_queue`,
`val_throw_trash` / `val_litter`, `val_listen` / `val_interrupt`, `val_include_friend` / `val_left_out`, `val_on_time` /
`val_late`, `val_phone_kind` / `val_phone_unkind`, `val_calm_breath` / `val_angry_face`.

**Science** (240 × 240 unless noted)

| Key | What |
|---|---|
| `sci_plant_parts` | 400 × 300, **tap regions** (below): a flowering plant with its roots in a cut-away of the soil: flower, two big leaves, stem, roots. |
| `sci_seed_sprout` | Germination in a soil cut-away: a split bean seed, its first root down, the curved shoot up with two small leaves. |
| `sci_butterfly_egg` | A leaf close up with a cluster of seven round, ribbed butterfly eggs. |
| `sci_caterpillar` | A striped caterpillar on a leaf with eaten holes, dot eyes, two feelers. |
| `sci_pupa` | A pale green chrysalis with a ring of gold dots, hanging from a twig. |
| `sci_ice_cube` | Three ice cubes on a small plate, a little melt-water. |
| `sci_water_drop` | One big falling water drop, two small ones, ripple rings below. |
| `sci_steam_kettle` | A kettle on a small gas stove (kompor), small flames, steam curling from the spout. |
| `sci_solar_system` | 400 × 300: the Sun at the left edge, eight planets on orbit lines in order, roughly in size (banded Jupiter, ringed Saturn). Not to scale. |
| `sci_magnet` | A red horseshoe magnet with pale tips holding a chain of paper clips and pulling a nail; short pull arcs. |
| `sci_battery_bulb` | A battery, two wires and a lit bulb (short rays). No + or − signs. |
| `sci_water_cycle` | 400 × 300: sun, sea, wavy vapour arrows rising, a cloud drifting to a mountain, rain, a river back to the sea. Arrows only. |
| `sci_food_chain` | 400 × 300: padi → tikus → ular → elang bondol, drawn arrows the way the food goes; no hunting shown. |
| `sci_microscope` | A school microscope, side view, a slide with a small green sample. |

**Maths** (240 × 240)

| Key | What |
|---|---|
| `math_bar_chart` | Four bars of different heights (sage, ochre, clay, slate) drawn on a sheet, tick marks on the side; no numbers or labels. |
| `math_pie_half` | A circle on a sheet, one half coloured, the other plain. |
| `math_number_line` | A line with arrows at both ends and nine evenly spaced ticks (the middle one taller); a frog has hopped two ticks at a time (dashed arcs). No numbers. |
| `math_ruler` | A wooden ruler with tick marks (longer every fifth), a pencil drawing along its edge. |
| `math_angle_right` | A right angle: two rays from one corner, the small square marker. |
| `math_angle_acute` | An acute angle (about 40°): two rays, a small arc marker. |
| `math_money_notes` | Two generic notes, fanned, and two coins. No denominations, emblems or real banknote design (amounts stay in text). |
| `math_thermometer` | A glass thermometer: round bulb, red column about two thirds up, marks without numbers. |

**Culture & society** (240 × 240 unless noted)

| Key | What |
|---|---|
| `soc_rumah_gadang` | Rumah gadang (Minangkabau): a long house on posts under a dark ijuk roof sweeping up into gonjong horns, a smaller gonjong over the front stairs, carved walls. |
| `soc_joglo` | Joglo (Jawa): an open pendopo on a low stone base, four pillars, a wide lower roof and the tall steep brunjung roof, clay tiles. |
| `soc_tongkonan` | Tongkonan (Toraja), side view: a carved house on posts under a long saddle roof sweeping up at both ends; a front post with stacked horns. |
| `soc_gamelan` | Gamelan: a saron (bronze keys on a carved box) with its mallet, a hanging gong on a frame behind. |
| `soc_sasando` | Sasando (Rote, NTT): a strung bamboo tube inside a fan of folded lontar leaf. |
| `soc_wayang` | A wayang kulit puppet in profile (generic, not a named character) on its rods, set in a banana trunk. |
| `soc_batik` | A cloth with a kawung pattern, partly rolled, and a canting drawing a wax line. |
| `soc_world_continents` | 400 × 200, **tap regions** (below): the seven continents, stylised (draft, not a survey map), neighbours in different colours, Indonesia's islands in Asia, Antarctica along the bottom. |
| `soc_saman_dance` | 400 × 300: Tari Saman (Aceh): three dancers kneeling in a row in dark costume with bright woven bands and head cloths, clapping; the middle one's hands up on the off-beat. |

`sci_plant_parts` (400×300): the plant's parts. `stem` lies over the middle of `leaf`; where they overlap the smaller
region (stem) wins in the app.

| Hotspot | x | y | w | h |
|---|---|---|---|---|
| flower | 0.36 | 0.04 | 0.28 | 0.30 |
| leaf | 0.22 | 0.34 | 0.56 | 0.22 |
| stem | 0.46 | 0.36 | 0.08 | 0.32 |
| root | 0.30 | 0.70 | 0.40 | 0.27 |

`soc_world_continents` (400×200): one box per continent; the boxes touch but do not overlap. They are rectangles, so
the western edge of Arabia falls in Africa's box, New Guinea in Asia's and Iceland in North America's.

| Hotspot | x | y | w | h |
|---|---|---|---|---|
| north_america | 0.03 | 0.00 | 0.42 | 0.44 |
| south_america | 0.25 | 0.44 | 0.15 | 0.40 |
| europe | 0.47 | 0.06 | 0.16 | 0.22 |
| africa | 0.45 | 0.28 | 0.18 | 0.44 |
| asia | 0.63 | 0.02 | 0.37 | 0.52 |
| australia | 0.81 | 0.54 | 0.19 | 0.30 |
| antarctica | 0.00 | 0.86 | 1.00 | 0.14 |

Known limits of these drafts: the values scenes are the heaviest drawables in the set (about 25–50 KB each, two or
three whole people from `figure()`; the six three-person scenes are 44–49 KB) — over the ~25 KB guide in
`art/README.md`. The SD uniform's white shirt and other paper-white things turn dark at night, dark hair turns light
(the known night limits of the family).

## History stories (`hist_*`, MODULES_LEVELS_STORIES §2, §4, §6.2) — DRAFT 2026-10-18

74 pictures for the Sejarah module, drawn in `art/tools/art_history.py` (illustrator brief:
`art/briefs/follow-up-12-history.md`). A story panel is one **scene** (`hist_bg_*`, 16:9, 400 × 225, opaque paper,
quieter than everything above it, calm open space in the left and lower thirds) plus up to four **layers** (every other
`hist_*` key: a single object or figure on a transparent background, full-strength ink and colour, no cast shadow)
that the app positions by `x, y, w` and animates gently. **No face likeness** (§4): people are flat ink silhouettes in
profile with no facial features, clothing told by the outline and a few paper-coloured inner lines, at most one colour
plate. No weapons, war, violence, religious symbols, flags, logos or readable text; all "writing" is abstract marks.

Layer viewports: 240 × 240 unless noted "wide" (320 × 240). Silhouettes share one scale: an adult is about 218 units
tall and a child about 158, feet on the bottom edge, so one `w` means one scale across a story.

**Scenes (16:9, 400 × 225)**

| Key | What |
|---|---|
| `hist_bg_sea` | Open sea under a high sky, a far island at right, three clouds; calm water left and front. |
| `hist_bg_harbor` | An old harbour: warehouses and a far anchored ship at right, a wooden pier from the right edge; open water left and front. |
| `hist_bg_classroom_old` | An old classroom: chalkboard with abstract chalk marks and a shuttered window on the right, wainscot, plain wall at left. |
| `hist_bg_library_old` | An old library: an arched window and tall book cases on the right; plain wall and floor left and front. |
| `hist_bg_lab` | An old laboratory: a window, shelves of glassware and a test-tube rack on the right, a long bench whose top edge (y ≈ 0.66) is a free surface. |
| `hist_bg_ward` | A long 19th-century hospital ward: three tall arched windows, three small far beds, a calm floor in front. |
| `hist_bg_village_java` | A Javanese village: volcano far right, terraced sawah, a limasan house, coconut palms; calm ground and a path in front. |
| `hist_bg_desert_road` | A desert track winding to the horizon past dunes, a small oasis far right, the sun; open sand left and front. |
| `hist_bg_sky_field` | A wide sky over low sand dunes by the sea (Kitty Hawk), a small wooden shed; most of the frame is open sky. |
| `hist_bg_green_hills` | Rolling green highland hills (Kenya) with a far snow-capped peak and two flat-topped acacias; calm front hill. |
| `hist_bg_hills_aceh` | Forested hills of Aceh: blue ridges, a band of mist, a river in the valley, two palms; calm front slope. |
| `hist_bg_city_old` | An old town street: tiled roofs, plastered houses with arched windows, an awning at right, a low far skyline at left, a cobbled street in front (no places of worship, no signs). |
| `hist_bg_night_sky` | A clear night sky: ochre stars and star crosses, a crescent moon, dark low hills; open sky for planets and figures. Reads in both themes. |
| `hist_bg_map_world` | An old world map on parchment: rough hand-drawn continents (a draft, not a survey map), a faint graticule, wave marks, a small compass rose (no letters). |
| `hist_bg_room_lamp` | A quiet room at night: a shuttered window with the moon and a curtain at right, a wooden table (top at y ≈ 0.66) whose top is a free surface; plain wall at left. |

**Silhouettes (no faces; facing right, feet on the bottom edge)**

| Key | What |
|---|---|
| `hist_sil_man` | A man standing in profile: hip-length jacket, trousers, short hair. |
| `hist_sil_woman` | A woman of about 1900 in profile: high-necked blouse, long full skirt, high bun, hands together in front. |
| `hist_sil_woman_kebaya` | A woman in a long kebaya and batik kain (ochre dots), low sanggul, hands folded in front (Kartini's era). |
| `hist_sil_woman_headscarf` | A woman standing tall in a long dress and a sage headscarf over head and shoulders, one hand open forward (leadership, care). |
| `hist_sil_boy` | A boy of about eight: shirt and shorts, one hand raised high. |
| `hist_sil_girl` | A girl of about eight: knee-length dress, ponytail, a small clay book held to her chest. |
| `hist_sil_teacher_class` | Wide. A teacher in kebaya (at right, facing left) holding an open book; three children sitting cross-legged on the floor listening (one girl in a kerudung). |
| `hist_sil_sailor` | A sailor shading the eyes with one hand, a coil of rope in the other; loose tunic, rolled trousers, barefoot, a clay headband. |
| `hist_sil_scholar` | A medieval scholar in a long robe and cloak, turban and short beard, reading an open book held at the chest; ochre sash. |
| `hist_sil_traveler` | A traveller walking with a staff and a water gourd: knee-length tunic, cloak, head-wrap with a tail, a clay bag at the hip. |
| `hist_sil_scientist` | A scientist (a woman, high bun) in a knee-length lab coat over a long skirt, holding a flask of sage liquid up to look at it. |
| `hist_sil_nurse` | A nurse of the 1850s walking with a Turkish folding lantern held out: long full dress, pale apron and cap. |

**Shared props**

| Key | What |
|---|---|
| `hist_oil_lamp` | A kerosene table lamp of about 1900: brass foot and font, burner collar, glass chimney, small flame (target of `glow`). |
| `hist_compass_old` | An old ship's compass on a tilted square wooden board: rings of tick marks (no characters), a clay/slate needle. |
| `hist_astrolabe` | A brass astrolabe: hanging ring and throne, tick-marked limb, openwork rete with star pointers, the alidade across. |
| `hist_book_stack` | A stack of four old books (two spines out, two page edges out), a ribbon hanging from the top one. |
| `hist_globe_old` | An old globe on a wooden stand with a brass meridian ring; continents are loose blobs, not a map. |
| `hist_quill` | A feather quill standing in a slate ink pot. |
| `hist_small_boat` | A small Nusantara perahu with a slanted tanja sail and a bamboo outrigger, on a few ripples (route layer on the map). |
| `hist_sunrise` | Wide. The sun rising over a water horizon: half disc, rays, a reflection (Mandela: a new day). |

**Per figure**

| Key | What |
|---|---|
| `hist_ki_hajar_school` | Wide. Taman Siswa: an open Javanese pendopo under a joglo roof on a stone platform, a chalkboard on an easel inside, three children seated on the floor. |
| `hist_slate_board` | A pupil's writing slate in a wooden frame with abstract chalk marks, a slate pencil, a sponge on a string. |
| `hist_kartini_letters` | A bundle of envelopes tied with a clay ribbon, one open letter of abstract hand-writing, a dip pen. |
| `hist_dewi_sartika_school` | Wide. Sakola Istri: a small Sundanese school house on low posts, woven bilik walls, julang-ngapak roof with crossed capit gunting, a blank board over the door. |
| `hist_sewing_kit` | A woven sewing basket: embroidered cloth, spool with threaded needle, pincushion with pins, thimble. |
| `hist_rumoh_aceh` | Wide. Rumoh Aceh: the Acehnese stilt house on round posts, plank walls with a carved band, steep thatched roof, carved tulak-angen gable screen, a ladder with nine rungs. |
| `hist_hatta_books` | An open wooden trunk packed with books (Hatta's library in exile), round reading glasses resting on top. |
| `hist_coop_shop` | Wide. A village koperasi kiosk: striped awning, shelves of jars, a two-pan balance on the counter, two rice sacks, a produce basket; blank sign board. |
| `hist_habibie_plane` | Wide. The N-250 in flight, side view: high wing, T-tail, twin turboprop with a six-bladed propeller; plain livery, no logos or registration. |
| `hist_blueprint` | A pinned blueprint: pale aeroplane side view, construction circles, dimension arrows without numbers, a ruler and a pencil. |
| `hist_treasure_ship` | Wide. Zheng He's treasure ship: a great six-masted junk with battened lug sails, a high stern castle, square bow, big rudder, on waves. |
| `hist_sejong_scroll` | A hanging scroll with columns of abstract ink dabs (not a script), wooden rollers, a small red seal. |
| `hist_rain_gauge` | The cheugugi (1441): a bronze cylinder on a carved stone pedestal, rain drops falling in. |
| `hist_spinning_wheel` | Wide. Gandhi's charkha: a spoked wheel with a string-zigzag rim, crank, drive band to a spindle, a thread from a cotton tuft. |
| `hist_sandals_path` | Wide. A long dusty road with footprints to the horizon; a pair of simple leather sandals in front (the Salt March). |
| `hist_khwarizmi_board` | Al-Khwarizmi's dust board: a wooden tray of sand with a square completed by rectangles, dots and a circle drawn by a stylus; no digits. |
| `hist_ibn_sina_book` | The Canon of Medicine: a large open book with abstract text lines, a drawn medicinal plant, a tooled clay cover, a sage ribbon. |
| `hist_herbs_mortar` | A bronze mortar and pestle with leafy herbs, a sprig, dried flowers and seeds. |
| `hist_camera_obscura` | Wide. A candle outside a dark box, two rays crossing through a pinhole, the flame's image upside down on the back wall. |
| `hist_lens` | A convex lens in a brass rim; four parallel ochre rays bend through it and meet at one bright point. |
| `hist_caravan` | Wide. Three loaded camels tied in a line walking right, a walker with a head-wrap leading them. |
| `hist_route_map` | Wide. A rolled travel map: coasts and islands, a dotted clay route between ports, a small ship, a compass rose; no names. |
| `hist_qarawiyyin` | Wide. The Qarawiyyin in Fez: a courtyard front of four horseshoe arches, a sage tiled roof, a zellige band of diamonds, a round fountain (no inscriptions or symbols). |
| `hist_handshake` | Two hands of different skin tones (deep and light) clasped; a patterned clay cuff and a plain slate cuff. |
| `hist_tree_seedlings` | A young tree just planted in a ring of soil, three seedlings in bags, a watering can (Green Belt Movement). |
| `hist_curie_flask` | A round-bottomed flask of sage liquid on a cork ring with short "shine" marks (no glow effect), a stoppered neck, a test tube (target of `glow`). |
| `hist_notebook` | A scientist's open notebook: abstract writing lines, a rising curve with dots, a sketched apparatus, a pencil. |
| `hist_nightingale_lamp` | Nightingale's lamp: a Turkish folding lantern (fanoos), pleated paper body between slate caps, candle flame inside, a carrying ring (target of `glow`). |
| `hist_hospital_bed` | Wide. An empty iron-framed 19th-century bed freshly made: white sheets, a sage blanket, a pillow; a bedside table with a cup and a cloth. |
| `hist_braille_dots` | Rows of raised six-dot cells on a card (the pattern is abstract), a fingertip reading them with small motion arcs. |
| `hist_braille_book` | A thick open Braille book: heavy pages covered in raised dots, no print. |
| `hist_telescope` | Galileo's refractor: a long leather-covered tube with tooled bands and a small eyepiece, on a wooden tripod, pointing up-right. |
| `hist_jupiter_moons` | Banded Jupiter with a small spot and the four Galilean moons in a line on a faint slate line. |
| `hist_wright_flyer` | Wide. The 1903 Flyer in flight seen from the front and a little above: muslin biplane, canard elevator in front, twin rudders behind, two pusher propellers, the pilot prone on the lower wing, skids. |
| `hist_bicycle_shop` | Wide. The Wright Cycle Company: a brick shop front with a striped awning, a display window with a bicycle, a door, a blank sign board, a safety bicycle leaning outside. |
| `hist_water_pump` | An old cast-iron hand pump with a long handle, water pouring from the spout over an open light-skinned hand with a clay sleeve. |
| `hist_hands_spelling` | An open palm (light skin, sage sleeve); another hand (mid skin, slate sleeve) pressing letters into it with a fingertip, small touch marks. |
| `hist_peanut_plant` | A peanut plant lifted to show what grows below: leaflets and small yellow flowers above the soil line, pegs, roots and pods below. |
| `hist_soil_field` | Wide. A field in ridged rows converging to the horizon, alternating rows of young peanut plants and sweet-potato vines (crop rotation), a blank marker stake. |

## Picture vocabulary, new levels (`pic_*` and `glyph_arrow_*`, MODULES_LEVELS_STORIES §6.4) — DRAFT 2026-10-18

82 pictures for the Menengah, Mahir and Master levels, in the family of the first 114 `pic_*` pictures: one object,
one figure or one small scene per picture, 240 × 240, no regions, no letters or digits (signs, screens, tickets, maps
and badges are blank or use shapes). People come from the same posable figure (`figure()` in `draw.py`) with light /
mid / deep skin; the ten jobs are five women and five men, a kerudung on two of the women. Source:
`art/tools/art_vocab2.py` (a drawing module loaded by `draw.py`); contact sheets
`art/preview/sheet_13v1_fu12_vocab_clothes_jobs.png`, `sheet_13v2_fu12_vocab_nature_routine.png`,
`sheet_13v3_fu12_vocab_hobbies_town.png`, `sheet_13v4_fu12_vocab_tech_health_animals.png` (each also `_night`).
Illustrator brief: `art/briefs/follow-up-12-vocabulary.md`.

**Clothes**

| Key | What | Notes |
|---|---|---|
| `pic_pants` | Long slate trousers, flat: waistband with loops and a button, fly, pockets, ochre stitching. | |
| `pic_dress` | A one-piece clay dress: puff sleeves, round paper collar, ochre waist sash, flared skirt with paper dots. | The top half tells it from `pic_skirt`. |
| `pic_skirt` | A pleated sage skirt on its own: waistband with a button, wide A-line, pleats fanning to the hem. | No top; shorter and wider than `pic_dress`. |
| `pic_jacket` | An ochre zip jacket: long sleeves, hood down, zip teeth, slanted pockets, slate rib cuffs and hem. | Long sleeves and zip tell it from `pic_shirt`. |
| `pic_socks` | A pair of socks, one in front of the other: ribbed cuffs with an ochre stripe, clay heel and toe. | |
| `pic_uniform` | The Indonesian SD uniform on a hanger: white short-sleeved shirt, clay tie, plain ochre badge on the pocket, clay (merah hati) shorts behind. | Badge has no text or emblem. White shirt turns dark at night (known limit). |
| `pic_sarong` | A checked sarung hung over a wooden rod: slate cloth with a clay and ochre check and a kepala band of ochre tumpal triangles. | Weak draft: reads as checked cloth; see the brief. |
| `pic_glasses` | A pair of glasses from the front and a little above, temples going back, sage-tinted lenses with a glint. | |

**Jobs** (adults in work clothes, one tool each; no weapons, no flame, no emblems)

| Key | What | Notes |
|---|---|---|
| `pic_farmer` | A farmer (petani, man, deep skin) in a caping, long sleeves, barefoot, a cangkul on the shoulder; young rice at the feet. | |
| `pic_chef` | A chef (koki, woman, light skin) in a white toque and double-breasted white jacket, clay neckerchief, a ladle raised. | Tells from `pic_cook` (man at a wok, apron). No knife. |
| `pic_driver` | A driver (sopir, man, mid skin), bust behind a big steering wheel, clay cap, collared shirt. | |
| `pic_nurse` | A nurse (perawat, woman, deep skin): white cap with a plain sage plus, sage scrub tunic, slate trousers, clipboard, pinned watch. | Tells from `pic_doctor` (white coat, stethoscope, glasses). Never the Red Cross emblem. |
| `pic_pilot` | A pilot (woman, mid skin): peaked cap, white shirt with epaulettes, slate tie, flight bag; a small plane in the corner. | Tells from `pic_police` by the white shirt, tie and plane. |
| `pic_firefighter` | A firefighter (man, light skin): clay helmet with ochre shield, slate jacket and trousers with ochre reflective bands, both hands on the nozzle of an ochre hose; water arcs away. | No flame anywhere. |
| `pic_police` | A traffic police officer (man, mid skin): peaked cap, khaki shirt, sage reflective vest with paper bands, one palm raised (stop), whistle at the lips. | No weapon, no Polri emblem. |
| `pic_fisher` | A fisher (nelayan, man, deep skin) standing in a wooden perahu on the sea, casting a jala net; clay head band. | Tells from `pic_fishing` (child, rod, jetty). |
| `pic_seller` | A seller (pedagang, woman in a clay kerudung, light skin) behind a counter of fruit baskets, handing an orange to a buyer. | Tells from `pic_market` (stall, no person) and `pic_chef`. |
| `pic_mechanic` | A mechanic (montir, woman in a clay kerudung, mid skin): sage coverall, a wrench raised, a tyre beside her. | |

**Weather, seasons, nature**

| Key | What | Notes |
|---|---|---|
| `pic_snow` | Snowflakes (three large crystals, small flakes) on a pale slate sky patch, a snow-capped pine, snowy ground. | Snow turns dark at night (known limit). |
| `pic_wind` | A tree bending, leaves blown away, three curling gust lines. | No cloud or rain: tells it from `pic_storm`. |
| `pic_storm` | A dark heavy slate cloud, an ochre lightning bolt, slanting rain. | Darker and busier than `pic_rain`. |
| `pic_spring_blossom` | A branch of small pink (blush) five-petal blossoms with buds, petals drifting. | Many blossoms on a branch vs. `pic_flower`. |
| `pic_autumn_leaves` | Three big maple-type leaves in clay and ochre drifting down, more fallen on the ground. | |
| `pic_snowman` | Two snowballs, coal eyes and buttons, clay carrot nose, clay scarf, twig arms, ochre knitted cap; pale sky patch. | White turns dark at night (known limit). |
| `pic_river` | A river winding from the hills towards us between grassy banks, stones and reeds. | Narrow far, wide near: tells it from `pic_lake` and `pic_sea`. |
| `pic_forest` | Many trees close together: pines and round trees in two rows, the back row lighter. | vs. `pic_tree`, `pic_park`. |
| `pic_volcano` | A broad cone with a crater, a little clay lava at the rim, a plume of grey smoke. | Crater and smoke tell it from `pic_mountain`; calm, not an eruption. |
| `pic_beach` | Ochre sand with a starfish, the sea with a foam edge behind, a leaning coconut palm. | Sand is the subject vs. `pic_sea`. |
| `pic_lake` | Still water closed in by grassy shore all round, hills behind, reeds and cattails in front. | Shore all round vs. `pic_river` / `pic_sea`. |
| `pic_moon` | A big ochre crescent with small stars on a dusk-slate patch. | No child: tells it from `sleep_moon`. |

**Daily routine** (children)

| Key | What | Notes |
|---|---|---|
| `pic_wake_up` | A child sitting up in bed, arms stretched high, yawning, blanket over the legs; the sun rising at the window. | vs. `pic_sleep` (lying, z marks). |
| `pic_shower` | The child is hidden behind a sage shower curtain; only the head peeks out, shampoo bubbles on the hair, the shower spraying behind. | Modest by design: no body shown. |
| `pic_brush_teeth` | A child brushing teeth (bust), a little foam, eyes smiling; a cup in the corner. | vs. `toothbrush` (object only). |
| `pic_get_dressed` | A child pulling a clay shirt on over a paper singlet, arms up in the sleeves, shirt bunched at the chest; down arrows. | Weak draft: can read as cheering at a glance. |
| `pic_breakfast` | A morning table: nasi goreng with telur ceplok, spoon and fork, a cup of tea, the sun rising in the corner. | |
| `pic_go_school` | A child in the SD uniform (white shirt, clay shorts) with a backpack, walking to the school flag (plain red over white). | Same flag question as `pic_school`. |
| `pic_study` | A boy at a desk under an ochre desk lamp, open book, stack of books, pencil, hand at the chin. | Lamp and book stack vs. `pic_read` / `pic_write`. |
| `pic_tidy_room` | A child putting a toy block into a toy box holding a ball, a block and a toy car. | |
| `pic_watch_tv` | A child on a floor cushion, remote in hand, turned to a TV on a low cabinet (screen: sun and hill). | vs. `pic_tv` (set alone). |
| `pic_go_home` | A child with a backpack walking to a small house with an open door, the late sun on the horizon. | House (not flag) vs. `pic_go_school`. |

**Hobbies**

| Key | What | Notes |
|---|---|---|
| `pic_draw_paint` | A sheet with a painted sun and hill, a brush loaded with clay paint, a wooden palette with four daubs. | |
| `pic_guitar` | An acoustic guitar, tilted: ochre body, sound hole, bridge, clay neck with frets, pegs. | |
| `pic_football` | The game: a ball flying into a goal net over grass, speed lines. | vs. `pic_ball`, `pic_play`. |
| `pic_badminton` | A racket with a strung oval head and ochre grip, a shuttlecock in flight. | |
| `pic_dance` | A girl in a traditional dance pose: one arm curved high, a clay selendang swirling, one knee lifted, flowers in her bun. | No specific regional costume. |
| `pic_camera` | A slate camera: viewfinder hump, big lens with a glint, clay shutter button, flash window. | No logo. |
| `pic_gardening` | A child watering flowers in a raised clay bed with a watering can. | vs. `pic_farmer`. |
| `pic_fishing` | A child sitting on a wooden jetty with a rod, line to a clay-and-white float, a small fish below. | vs. `pic_fisher`. |

**Town & travel** (buildings by shape and one object, never by words or logos)

| Key | What | Notes |
|---|---|---|
| `pic_bank` | A pillared building with a clay pediment and steps, a big plain coin in the pediment. | |
| `pic_post_office` | A building with a big envelope sign on the roof and a clay pillar mailbox with a slot. | No Pos Indonesia mark. |
| `pic_restaurant` | A shopfront: scalloped sage awning, a sign showing a plate with spoon and fork, a steaming bowl on a table in the window. | |
| `pic_library` | Two tall shelves full of coloured books, a reading table with an open book. | |
| `pic_hotel` | A tall clay building with rows of windows, three stars over the sage entrance canopy, a suitcase at the door, a sign showing a bed. | Stars and suitcase vs. `pic_hospital`. |
| `pic_airport` | A control tower with a glass cab, a low terminal, the runway, a plane taking off. | |
| `pic_suitcase` | A clay suitcase on wheels with ribs, a pulled-up slate handle, a blank luggage tag. | vs. `pic_bag`. |
| `pic_ticket` | An ochre ticket with notched ends, a dotted tear line, a bar pattern on the stub, a small train shape, blank lines. | No letters or digits. |
| `pic_map_paper` | A folded paper map in four panels: green land, a slate river, a dotted route ending at a clay pin. | |
| `pic_traffic_light` | A dark housing on a pole with three lamps: clay (red) top, ochre (amber), sage (green). | Muted palette colours; see the brief's open point. |
| `pic_bridge` | An ochre stone arch bridge with a railing across a river, grassy banks. | |
| `glyph_arrow_left` | Turn left: a road arrow going up, then bending left (slate broad stroke under an ink line). | Interaction-glyph family; mirrors `glyph_arrow_right`. |
| `glyph_arrow_right` | Turn right: a road arrow going up, then bending right. | |
| `glyph_arrow_straight` | Straight on: a road arrow going straight up. | |

**Technology** (screens show a simple hill-and-sun picture, never text)

| Key | What | Notes |
|---|---|---|
| `pic_computer` | A monitor on a stand, a keyboard and an ochre mouse. | Keyboard and mouse vs. `pic_tv` / `pic_tablet`. |
| `pic_tv` | An ochre box TV with two antennas, side knobs and short legs. | |
| `pic_radio` | A clay portable radio: handle, round speaker grille, tuning window with a needle, two knobs, antenna. | |
| `pic_tablet` | A landscape tablet with a thin frame and an ochre stylus beside it. | Landscape and stylus vs. `pic_phone` (upright, app squares). |
| `pic_headphones` | Over-ear headphones: slate headband, clay ear cups, a coiled cord. | |
| `pic_robot_toy` | A toy robot: slate head with antenna and round eyes, ochre body with dials, claw hands, wheels, a wind-up key. | |

**Health** (gentle: no needles, blood or faces on organs)

| Key | What | Notes |
|---|---|---|
| `pic_fever` | A child with tired eyes and flushed cheeks, a thermometer in the mouth, a cool cloth on the forehead, a sage blanket round the shoulders. | vs. `pic_hot` (sun, fan, sweat). |
| `pic_cough` | A child coughing into the sleeve of the raised arm, eyes squeezed shut, small puffs. | Shows the good habit. vs. `pic_tired`, `pic_sorry`. |
| `pic_medicine` | A clay syrup bottle with a blank label and a sage plus, a spoon of syrup, two capsules. | No needle. |
| `pic_heart_organ` | The heart as a simple organ: clay body tipped left, aorta arching on top, slate veins, drawn vessels. | No face, nothing gory. |
| `pic_lungs` | Two blush lungs, the windpipe with rings, branching airways. | |
| `pic_teeth` | A big molar and a smaller front tooth with roots, on a sage patch. | vs. `pic_mouth`. Teeth turn dark at night (known limit). |
| `pic_exercise` | A child in sports clothes and a clay headband doing a star jump, motion marks, a sweat drop. | vs. `pic_dance`, `pic_happy`. |
| `pic_healthy_plate` | Isi Piringku from above: vegetables and fruit (half), rice and protein (tempe, fish) (half); a glass of water. | |

**Animals** (friendly, never menacing)

| Key | What | Notes |
|---|---|---|
| `pic_tiger` | A tiger walking, face to us: ochre with ink stripes, paper muzzle and belly, round ears, closed smile. | No teeth or claws. |
| `pic_frog` | A sage frog on a lily pad: big eyes on top, wide smile, folded legs. | |
| `pic_butterfly` | A butterfly from above: four ochre wings edged in clay with spots, slate body, antennae. | |
| `pic_snake` | A sage snake coiled with an ochre pattern, head up, big round eyes, a smile. | No fangs. |
| `pic_turtle` | A walking kura-kura: domed sage shell with an ochre plate pattern and rim, head out smiling, stubby legs. | |
| `pic_orangutan` | An orangutan hanging from a branch by one long arm: shaggy clay hair, pale face, gentle smile. | No tail: vs. `pic_monkey`. |

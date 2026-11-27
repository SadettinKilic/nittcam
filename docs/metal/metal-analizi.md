# Metal desteği: tasarım analizi (M-Metal)

Tarih: 2026-11-23 · Yazan: CTO · Durum: kabul edildi (D-118, D-130; spec T340 ile işlendi, 2026-11-28). D-130 bu belgedeki bayrak ve sıra metinlerinin önüne geçer: `acm` ve `aluminium` bayraksız görünür; ACM NC doğrulanmamış işaretiyle, alüminyum NC MB7 (T358, T359) sonrası verilir. Sayılarda §4.5 (araştırmayla karşılaştırma) §4.2 ve §7'nin önüne geçer.
Kapsam kararı sahibindir: "ürüne metal eklenir". Bu belge neyin, hangi sırayla ve hangi güvenlik kurallarıyla ekleneceğini anlatır. Kod değişikliği içermez. Görevler `docs/BACKLOG.md` içindeki "M-Metal" bölümündedir (T340–T372).

Bu belgedeki kesim sayıları **başlangıç önerisidir**. Kaynak: genel talaşlı imalat bilgisi ve ACM üreticilerinin işleme kılavuzları. Hiçbiri bizim makinede ölçülmedi. Sayılar `docs/materials/kesim-degerleri-arastirma.md` (ayrı araştırma, bu belge yazılırken henüz yoktu) ve makine testi ile kesinleşir. Belirsiz olan her yer "doğrulanacak" diye işaretlidir.

## 1. Kısa özet

- "Metal" tek bir şey değildir. Router için dört ayrı kademe vardır: (A) alüminyum kompozit panel, (B) alüminyum sac/levha, (C) pirinç/bakır, (D) çelik/paslanmaz.
- Öneri: **A önce, B ardından, C sonra, D hiç.** Gerekçeler bölüm 3'te.
- Bugünkü kod malzemeyi altı sabit türle ve tek bir soruyla tanır: "damarı var mı?". Gerisi (köprü ölçüsü, takım tipi, dalma, görünüm) ahşap plakaya göre sabit yazılmıştır.
- Çözüm `if metal` yığını değil, bir **malzeme davranış tablosu**dur (`MaterialTraits`). Her tür için "damar/yön var mı, kenar bandı olur mu, hangi takım, soğutma şart mı, dalma nasıl, paso tavanı ne" sorularının cevabı tek yerde durur. Ekranlar, takım yolu ve bağımsız G-code denetçisi bu tabloyu okur.
- Mevcut altı tür için tablo bugünkü sabitleri aynen taşır. Yeni alanların hepsi isteğe bağlıdır. Bu yüzden ahşap ve plastik için G-code **bayt bayt aynı** kalır; golden dosyalar değişmez.
- Metalde yanlış değer takım kırar, parça fırlatır. Bu yüzden metal işi beş ek kapıdan geçer: makine beyanı, malzemeye göre sınırlar, bağımsız denetçi kuralları, ayrı doğrulama (test kesimi), insan onayı.
- Saha testi 1 (ahşap, MDF, Mach3) önce gelir. Ondan önce yalnız üç görev başlayabilir (T340–T342): belge, davranış tablosu ve ekranların tabloyu okuması. Hepsi çıktıyı değiştirmez.

## 2. Bugünkü model: "ahşap plaka" varsayımı nerede?

### 2.1 Malzeme türü

- `packages/core/src/machine/material-kinds.ts`: altı sabit tür: `mdf`, `plywood`, `melamine`, `solidWood`, `acrylic`, `pvc`.
- `material.ts`: yazım eşlemeleri (`materialKindOf`), tek davranış sorusu `materialHasGrain` (ilk dört tür: evet).
- `library.ts`: şirket malzeme kütüphanesi: tür, ad, kalınlıklar, renk/doku (`tone`: natural, oak, walnut, white, grey, anthracite, black, clear), varsayılan damar, plaka ölçüleri. Hazır ölçüler mobilya plakasıdır (2800×2070, 2440×1220).
- Veritabanında `materials.kind` serbest metindir; geçerliliği core denetler. `offcuts.material` serbest metin, `offcuts.grain` tam sayı.

### 2.2 Makine profili ve kesim setleri

- `profile.ts`: bir kesim seti = tür + kalınlık → `feed`, `plungeFeed`, `rpm`, `stepDown`, `tool`, isteğe bağlı `tabs`. Soğutma, dalma tipi, finiş payı yok.
- Takım tipleri: `flatEndMill`, `ballEndMill`, `compression`, `vBit`, `drill`. Takımda yalnız çap, kesici boyu, ağız sayısı var. V uçta **açı ve uç düzlüğü yok**; bugün V uç hiçbir işlemde kullanılamıyor (`OPERATION_TOOL_TYPES`).
- Tutma: `vacuum | clamp | tSlot` ve vakum M kodları. Soğutma çıkışı yok.
- **Çakışma:** örnek profillerde vakum `M7` ile açılır, `M9` ile kapanır. Mach3 ve standart G-code'da `M7` = sis soğutma, `M8` = sıvı soğutma, `M9` = ikisini de kapat. G-code okuyucumuz da `M7/M8/M9`'u soğutma olarak okur.
- Yeni set eklerken formun başlangıç değerleri sabittir: 5 000 mm/dk, 18 000 dev/dk (`newParamSet`). Bu değerler alüminyum için tehlikelidir.
- Doğrulama (air cut, test kesimi) profile bağlıdır; malzemeye bağlı değildir. MDF ile doğrulanan makine her malzemede "doğrulanmış" görünür.

### 2.3 Proje şeması

- `stock`: `material`, `thickness`, `sheet.grain` (0–180° veya `null`).
- Parça: `grain {mode, angle}`, `edgeBand` (dört kenar), delikler, iç konturlar, işlemler (`outside | inside | online | pocket | none`).
- `cutting`: köprü (`tabs`), ince tabaka (`skin`), `leadIn`, `direction`, takım başına `spindleRpm` ve `feeds`, giriş (`entry`: yoksa dik dalma), işlem başına takım.
- Sabitler ahşaba göre: köprü varsayılanı 4 × 10 mm, kalan malzeme en çok 3 mm; **köprü yüksekliği en az 1 mm ve en çok kalınlık − 1 mm** (`TAB_BOUNDS`). 1,5 mm alüminyum sacda bu aralık boştur: köprü tanımlanamaz. Küçük parça eşiği 0,05 m² veya 100 mm kenar ("vakum tutamaz" mantığı).

### 2.4 Dizilim, takım yolu, post, denetçi

- Dizilim: damar kuralı yönsüzdür (θ ve θ + 180° aynı). Parça arası boşluk = takım Ø + 0,1 mm. "Küçük parça önce kesilir (vakum güçlüyken)".
- Takım yolu: kontur varsayılanı **dik dalma**. Rampa isteğe bağlı (T324). Delik ve cepte helis girişi 3°; halka yarıçapı 0,5 mm altındaysa dik dalma. Finiş pasosu yok (cepte duvar halkası son kesilir, o kadar).
- Post (`packages/machines/mach3`, `generic`): spindle, bekleme, vakum yazar. Soğutma yazmaz.
- Bağımsız denetçi (`gcode-check`): R1–R10 + MODEL, LAYOUT, TOOLS, INPUT. Malzemeye bağlı hiçbir kural yok. Vakum kuralları var (`VACUUM_NOT_ON`, `END_VACUUM_ON`).
- Doğrulama kodları (`validate`): damar, kenar payı, takım uygunluğu, devir ve besleme makine sınırı. Talaş yükü yalnız gösterilir (`spindle.ts`), sınır değildir.

### 2.5 Malzemeyi bilen ekranlar

| Yer | Dosya | Varsayım |
| --- | --- | --- |
| Adım 1 malzeme seçici | `components/wizard/machine-step.tsx` | İki grup: "Ahşap", "Plastik"; "Mermer / taş (yakında)". Hazır ölçüler mobilya plakası |
| Adım 1 damar kadranı | aynı | `materialHasGrain` ile görünür |
| Kesim listesi | `components/parts/cut-list-*.tsx`, `lib/cut-list-grid.ts` | "Damar" ve "Kenar bandı (mm)" sütunları her zaman var |
| Dolap ekle | `components/parts/cabinet-dialog.tsx` | Mobilya kutusu; her malzemede açık |
| Çizim tahtası | `components/editor/*` | Parça damarı, dogbone; V-kanal yok |
| Dizilim | `components/layout-view/*` | Damar çizgileri, damar uyarısı |
| Simülasyon / Kesim ayarları | `components/simulation/*` | Köprü, ince tabaka, dalma, devir, besleme; soğutma ve finiş yok |
| 3D | `lib/preview3d/textures.ts`, `components/preview3d/materials.ts` | Altı görünüm, hepsi mat; bilinmeyen tür MDF gibi çizilir |
| PDF ve etiket | `lib/server/pdf/*`, `core/report/labels.ts` | Damar oku, kenar bandı |
| Ayarlar → Malzemeler | `app/ayarlar/malzemeler/*`, `lib/material-form.ts` | Tür listesi, ahşap tonları, damar |
| Artık parça | `app/projeler/offcut-dialog.tsx`, `lib/offcut-form.ts` | Damar alanı `materialHasGrain` ile |
| Makine formu parametre tablosu | `app/makineler/machine-form.tsx`, `lib/machine-form.ts` | Sabit başlangıç değerleri, köprü sınırları |
| Ana sayfa, Projeler | `app/page.tsx`, `app/projeler/projects-view.tsx` | Tür adı |
| Saha kiti ve doğrulama | `app/makineler/[id]/saha-kiti`, `dogrulama` | 200×200 ahşap test parçası |

`materialHasGrain` 11 dosyada, `materialKindOf` 14 dosyada çağrılıyor. Dağınık ama az: toplanması tek görevdir (T342).

## 3. "Metal" ne demek? Kademeler ve öneri

Ürün köprü tipi (gantry) router içindir. Bu makineler hafiftir, spindle'ları hızlıdır (18–24 bin dev/dk) ve düşük devirde torkları yoktur. Tablaları çoğu zaman vakumlu MDF'dir. Karar bu gerçeğe göre verilir.

### Kademe A: alüminyum kompozit panel (ACM, "kompozit") → **ilk, önerilir**

- Yapı: 0,3–0,5 mm iki alüminyum yüzey, arada plastik çekirdek. Kalınlık 3 ve 4 mm (seyrek 6). Plaka 1250×3200, 1500×3200, 1250×2440 ve daha uzun.
- Ahşap router'da sorunsuz kesilir: kuru, vakumla tutulur, yüksek devir uygundur. Makine riski plastikle aynı sınıftadır.
- Asıl değer **V-kanal + büküm**dür: arka yüzden V uçla kanal açılır, ön yüzde yaklaşık 0,8 mm (0,5 mm sac + 0,3 mm çekirdek, doğrulanacak) kalır, panel elle bükülür. Tabela ve cephe kaseti böyle yapılır.
- Spec §2.2 tabela üreticisini zaten hedefliyor; "V-oyma yok" sınırı bu kademeyle kalkar (yalnız V-kanal; yazı V-oyması değil).
- İki alt adım: **A1** yalnız kesim (neredeyse bedava: yeni tür + davranış tablosu), **A2** V-kanal.
- Yeni kavramlar: işlenen yüz (panel yüzü aşağı bakar, parça aynalanır), yönlü yüzey (film üstündeki ok), V uç geometrisi.

### Kademe B: alüminyum sac ve levha → **ikinci, güvenlik paketiyle**

- Kapsam: 1–6 mm sac, en çok 10 mm levha. 2D kontur, cep, delik. Alaşım: 5754, 5083 (sac), 6061, 6082 (levha). 1050 gibi yumuşak alaşımlar sıvanır; uyarıyla.
- Router'da yapılabilir ama hata affetmez. Şartlar: tek ağızlı karbür freze, rampa ile giriş, sığ paso, doğru talaş yükü, sis soğutma veya hava üfleme, her parçada köprü veya ince tabaka, mekanik sıkma.
- Her makine yapamaz. Makine profili bunu **beyan** eder (bölüm 6). Beyan yoksa alüminyum işi dosya vermez.
- B kademesi A'dan sonra gelir, çünkü güvenlik paketi (bölüm 7) büyüktür ve ayrı makine testi ister.

### Kademe C: pirinç ve bakır → **sonra**

- Pirinç (MS58) kuru ve temiz kesilir; isimlik, plaket, ince sac. Bakır sıvanır ve zordur.
- Değerli kısım **oyma**dır (V uçla yazı ve desen). Bu, bugün dışarıda olan "V-oyma ve yazı aracı" işidir; A2'deki V uç altyapısına dayanır.
- Öneri: B'den sonra pirinci tür olarak ekle (aynı aile, başka sayılar). Bakır "yakında" kalsın. Pazar küçük; acele yok.

### Kademe D: çelik ve paslanmaz → **kapsam dışı, kalıcı**

- Kesme hızı: çelik 60–120 m/dk ister. Ø6 takımda bu 3 000–6 000 dev/dk eder. Router spindle'ının alt sınırı genelde 6 000'dir ve o devirde torku yoktur.
- Kuvvet: alüminyumun yaklaşık üç katı. Köprü esner, takım kırılır.
- Soğutma: bol sıvı gerekir. MDF fire tabla ve vakum tablası sıvıyla çalışmaz.
- Yangın: kıvılcım ve sıcak talaş, ahşap tozu ve toz emme sistemiyle aynı ortamda olur.
- Pazar: sac çelik lazer ve plazma ile kesilir. Router'a iş gelmez.
- Sonuç: tür olarak eklenmez. Kullanıcı "çelik" yazarsa "tanınmayan malzeme" kalır ve dosya üretilmez. Arayüzde "desteklenmez" notu yeter.

## 4. Genelleme: malzeme davranış tablosu

### 4.1 Fikir

Yeni dosya `packages/core/src/machine/material-traits.ts`. Saf veri, zod yok. Her `MaterialKind` için bir satır. Aile (`family`) ortak varsayılanı verir, tür üstüne yazar.

```ts
type MaterialFamily = 'woodBoard' | 'plastic' | 'composite' | 'nonFerrous';

interface MaterialTraits {
  family: MaterialFamily;
  release: 'released' | 'flagged';            // flagged: yalnız bayrak açıkken görünür
  direction: {
    kind: 'none' | 'axial' | 'directed';      // axial: 30° = 210°; directed: ok, 180° farklı
    label: 'grain' | 'surface' | 'filmArrow'; // "Damar yönü" / "Yüzey yönü" / "Film oku"
    defaultOn: boolean;
  };
  face: { film: boolean; machined: 'front' | 'back' }; // işlenen yüz; back = parça aynalanır
  edgeBand: boolean;
  cabinet: boolean;                            // "Dolap ekle"
  toolTypes: Record<OperationToolKind | 'vgroove', readonly ToolType[]>;
  coolant: 'none' | 'recommended' | 'required';
  entry: { straightPlunge: boolean; maxRampDeg: number; defaultRampDeg: number };
  stepDown: { maxPerDiameter: number | null }; // null = sınır yok (bugünkü ahşap)
  chipLoad: readonly { maxDiameter: number; min: number; max: number }[] | null;
  finish: { defaultAllowance: number | null }; // mm; null = finiş pasosu varsayılan kapalı
  tabs: { defaults: TabDefaults; bounds: TabBounds; everyPart: boolean };
  skin: { min: number; belowThickness: number };
  smallPart: { area: number; minSide: number };
  minPartSide: number | null;                  // altı: hata
  spacing: { extraGap: number };               // takım Ø üstüne varsayılan pay
  vGroove: { minRemaining: number; defaultRemaining: number } | null;
  holdDownHint: string;                        // çeviri anahtarı
  sheetPresets: readonly { a: number; b: number }[];
  thicknessPresets: readonly number[];
  look: { token: string; roughness: number; metalness: number; stripes: boolean };
  label: { direction: boolean; band: boolean; deburr: boolean; face: boolean };
  verificationFamily: MaterialFamily;          // test kesimi hangi aile için geçerli
}
```

Kurallar:

- Mevcut altı türün satırı bugünkü sabitleri **aynen** taşır (`TAB_DEFAULTS`, `TAB_BOUNDS`, `SKIN_BOUNDS`, `OPERATION_TOOL_TYPES`, `materialHasGrain`). Bir anlık görüntü testi bunu kilitler.
- Bilinmeyen tür (`materialKindOf` → `null`) bugünkü davranışı alır. Hiçbir eski proje davranış değiştirmez.
- `materialHasGrain(kind)` kalır, içi `traitsOf(kind).direction.kind !== 'none'` olur.
- Tabloyu üç yer okur: arayüz (ne görünür), takım yolu ve doğrulama (ne üretilir), **bağımsız denetçi** (ne kabul edilir). Denetçi sınırı tablodan alır ama hesabı üreticiden bağımsız, okunan G-code üzerinden yapar. Üretici bir sınırı atlasa bile denetçi yakalar.
- Makine sertliği tabloyu sıkılaştırır, gevşetmez (bölüm 6).

### 4.2 Ayar × malzeme (tam tablo)

"Aynı" = bugünkü gibi, dokunulmaz. "Gizli" = ekranda yok, veride yok sayılır. Sayılar başlangıç önerisidir (doğrulanacak).

| Ayar | Ahşap plaka | Plastik | ACM | Alüminyum |
| --- | --- | --- | --- | --- |
| Tür listesi | aynı | aynı | yeni: `acm` | yeni: `aluminium` (alaşım kütüphanede) |
| Hazır plaka ölçüsü | aynı | aynı | 1250×3200, 1500×3200, 1250×2440 | 1000×2000, 1250×2500, 1500×3000 |
| Hazır kalınlık | aynı | aynı | 3, 4, 6 | 1 · 1,5 · 2 · 3 · 4 · 5 · 6 · 8 · 10 |
| Yön alanı | "Damar yönü", yönsüz | gizli (aynı) | "Film oku yönü", **yönlü**, metalik renkte açık | "Yüzey / hadde yönü", yönsüz, varsayılan kapalı |
| İşlenen yüz | yok | yok | **yeni:** "Arka yüzden işle" (varsayılan açık) | yeni, varsayılan "ön yüz"; filmli sacda seçilir |
| Kenar bandı | aynı | aynı (bugün açık; saha testinden sonra gizlenebilir) | gizli | gizli |
| Dolap ekle | aynı | aynı | gizli | gizli |
| Takım tipi (kontur) | düz, sıkıştırma | düz, sıkıştırma (aynı) | yalnız düz (tek ağız önerilir) | yalnız düz, 1–2 ağız; sıkıştırma ve küresel yasak |
| V-kanal işlemi | yok | yok | **yeni** (V uç, açı 90°/135°) | yok (C kademesinde oyma) |
| Soğutma | yok | yok (hava önerilir, bilgi) | önerilir: hava (bilgi, kural yok) | **şart**: sis, MQL veya hava; programdan ya da elle |
| Giriş (dalma) | dik veya rampa (aynı) | aynı | rampa (varsayılan 2°, en çok 5°; §4.5) | **rampa/helis şart** (varsayılan 2°, en çok 5°); dik dalma yalnız matkapla |
| Paso derinliği tavanı | yok (aynı) | yok (aynı) | yok | ≤ 0,5 × takım Ø (hafif makinede ≤ 0,25 × Ø) |
| Talaş yükü | yalnız gösterilir | yalnız gösterilir | yalnız gösterilir (araştırma bandıyla uyarı) | **sınır** (§4.5): Ø ≥ 6: 0,04–0,10; Ø 3–6: 0,02–0,05; Ø < 3: 0,005–0,02 mm/diş |
| Devir | makine aralığı | aynı | aynı | makine aralığı + kesme hızı bandı (uyarı) |
| Köprü varsayılanı | 4 × 10 × ≤ 3 mm | aynı | 4 × 6 × 1 mm | 4 × 5 × 0,8 mm; **her parçada** |
| Köprü sınırı | en ≥ 3; yük. 1 … t − 1 | aynı | en ≥ 3; yük. 0,5 … t − 0,5 | en ≥ 3; yük. 0,3 … t − 0,3 |
| İnce tabaka | 0,2 … t − 1 | aynı | gizli (alt sac zaten ince) | 0,1 … 0,3 (köprünün alternatifi) |
| Küçük parça eşiği | 0,05 m² / 100 mm | aynı | aynı | yok: her parça tutulur; en küçük kenar 20 mm altı hata |
| Finiş pasosu | yok | yok | yok | **yeni**, varsayılan açık, pay 0,2 mm |
| Kesim yönü | aynı | aynı | aynı alan; varsayılan karşı yön (conventional, §4.5) | aynı alan; varsayılan tırmanma, finişte tırmanma |
| Lead-in | aynı | aynı | aynı | yay (çizgi seçilemez: iz bırakır) |
| Parça arası boşluk | takım Ø + 0,1 | aynı | aynı | takım Ø + 3 (ince duvar titrer) |
| Kenar payı | 10 | aynı | 10 | mengenede en az 25 (mengene bölgesi) |
| Kesim sırası | küçük parça önce | aynı | aynı | içten dışa; küçük-önce kuralı kapalı |
| Fire tabla payı | profil değeri | aynı | aynı | profil değeri, en çok 0,3 önerilir |
| Tutma ipucu | vakum | vakum | vakum + arka yüz | mengene / çift taraflı bant; vakum tek başına yetmez uyarısı |
| Görünüm (tuval, 3D) | aynı | aynı | düz renk + metalik seçenek, yarı mat | metalik, fırçalı çizgi yön boyunca |
| Etiket | damar oku, bant | aynı | film oku, "yüz aşağı", büküm sayısı | yön oku (varsa), "çapak al" notu; bant yok |
| PDF başlığı | "MDF, 18 mm" | aynı | "Kompozit panel, 4 mm" | "Alüminyum 5754, 3 mm" + soğutma satırı |
| Doğrulama ailesi | ahşap plaka | plastik (bugün ahşapla ortak) | kompozit | demir dışı metal |

### 4.3 Sahibin sorusu: "damar ahşapta var, metalde yok ama farklı ayar olacak mı?"

Kısa cevap: **evet, yön kavramı metalde de var ve aynı alanı kullanmaya değer; ama adı ve bir kuralı değişir.**

- **Alüminyum sac:** hadde yönü vardır. Fırçalı (satine) ve eloksallı yüzeyde gözle görülür; yan yana duran iki parça farklı yönde kesilirse renk farkı çıkar. Büküm yapılacaksa büküm çizgisi hadde yönüne dik olmalıdır, yoksa çatlar. Bu yön **yönsüzdür**: 30° ile 210° aynıdır. Yani ahşap damarıyla aynı matematik. Çoğu işte önemsizdir; varsayılan kapalı gelir.
- **ACM:** koruyucu filmin üstünde ok basılıdır. Metalik ve fırçalı renklerde tüm parçalar **aynı ok yönünde** olmalıdır; 180° dönmüş parça ışıkta farklı görünür. Bu yön **yönlüdür**: 30° ile 210° farklıdır. Düz renklerde önemsizdir.
- **Karar:** tek kavram, aynı alanlar (`stock.sheet.grain`, parça `grain`). Davranış tablosu üç şey söyler: var mı, yönsüz mü yönlü mü, ekrandaki adı ne. Ekranda ahşapta "Damar yönü", alüminyumda "Yüzey yönü", ACM'de "Film oku yönü" yazar. Kadran, kesim listesi sütunu, dizilim kuralı ve etiket oku aynı kodu kullanır.
- **Tek fark:** yönlü malzemede dizilim, sabit parçayı iki açıdan (g ve g + 180°) değil yalnız bir açıdan (g) yerleştirir. Parça açısı bugün 0–180° saklanır; yönlü malzeme için parçaya isteğe bağlı `grain.flip` (180° çevrik) eklenir. Alan yoksa bugünkü davranış aynen sürer.
- **Metale özgü yeni ayarlar ayrıca gelir:** soğutma, zorunlu rampa, paso ve talaş yükü sınırı, finiş pasosu, her parçada köprü, işlenen yüz. Bunlar damarın yerine geçmez; ek ayarlardır.
- **Metalde kaybolanlar:** kenar bandı, dolap üretici, sıkıştırma freze, "küçük parçayı vakum tutar" mantığı.

### 4.4 Kütüphane girdisi (Ayarlar → Malzemeler)

Tür tek başına yetmez: 5754 ile 6082 farklı kesilir, ACM'de renk kodu ve film önemlidir. Kütüphane girdisine isteğe bağlı `props` eklenir:

- Alüminyum: `alloy` (ör. "5754"), `temper` (ör. "H22"), `finish` (ham / fırçalı / eloksallı), `film` (var/yok).
- ACM: `colorCode`, `metallic` (yönlü yüzey açık gelir), `skin` (yüzey sacı kalınlığı 0,3 / 0,5), `fireClass` (bilgi).

Kesim setleri bugünkü gibi makine profilinde, tür + kalınlık ile bağlı kalır (D-029). Alaşım farkı ilk sürümde projede besleme düşürerek karşılanır. Aynı kalınlıkta iki alaşım için ayrı set ihtiyacı açık konudur (bölüm 9).

### 4.5 Araştırma dosyasıyla karşılaştırma (T340, 2026-11-28)

§4.2 ve §7'deki sayılar `docs/materials/kesim-degerleri-arastirma.md` (b.7, b.8, c, d ve "Alüminyum ve ACM" bölümü) ile karşılaştırıldı. Kural (D-130): iki kaynak ayrışırsa **temkinli değer** kazanır; hiçbir kaynağın doğrulamadığı sayı "doğrulanacak" diye işaretlenir. Bu tablo §4.2 ve §7'nin önüne geçer; davranış tablosu (`MaterialTraits`, MB2 sonrası) bu değerleri taşır.

| Konu | Analiz (§4.2 / §7) | Araştırma | Karar | Durum |
| --- | --- | --- | --- | --- |
| Alüminyum talaş yükü, Ø ≥ 6 | 0,02–0,10 | c: 1 ağız Ø6 0,076–0,18, Ø8 0,10–0,20; 2 ağız Ø6 0,05–0,155; d başlangıç 0,059–0,100; uyarı tabanı cl_min × 0,8 | **0,04–0,10** (taban = en düşük cl_min 0,05 × 0,8; tavan analizden, araştırmanın başlangıç değerleri içinde kalır) | tavan doğrulanacak |
| Alüminyum talaş yükü, Ø 3–6 | 0,01–0,05 | c: Ø3–Ø4 0,05–0,133; Sorotec Ø3 0,025 | **0,02–0,05** (taban = 0,025 × 0,8) | tavan doğrulanacak |
| Alüminyum talaş yükü, Ø < 3 | 0,005–0,02 | kaynak yok | aynı | doğrulanacak |
| Alüminyum paso tavanı | ≤ 0,5 × Ø (hafif makinede ≤ 0,25 × Ø) | Sorotec en çok 0,5 × D; d başlangıç 0,25 × D | aynı; varsayılan paso 0,25 × Ø | uyumlu |
| Alüminyum rampa açısı | varsayılan 2°, en çok 5° | üretici sayısı yok; uygulamanın 3° rampası "uygun"; ikincil kaynak 6,1° | **2° / 5°** (ikisi de temkinli tarafta) | doğrulanacak |
| ACM giriş | dik serbest | "alüminyum gibi rampa"; c: ramp-req | **rampa** (2° / 5°); kural 12 kompozitte de uygulanır | doğrulanacak |
| ACM kesim yönü | aynı (tırmanma) | Alucobond: karşı yön (conventional) | **karşı yön** varsayılan | uyumlu (kaynaklı) |
| Alüminyum kesim yönü | tırmanma | Sorotec: boşluksuz makinede tırmanma | aynı | uyumlu |
| Alüminyum soğutma | şart: sis veya hava | MQL, sis, hava; etanol | **şart**: sis, MQL veya hava (D-118: hava tek başına sıkı sınırla) | uyumlu |
| ACM soğutma | yok | Dibond: gerekmez; c: hava | **önerilir: hava** (bilgi, kural yok) | uyumlu |
| Takım tipi | ACM düz tek ağız; alüminyum düz 1–2 ağız, sıkıştırma ve küresel yasak | O-flute tek ağız; 2 ağız ZrN parmak freze | aynı | uyumlu |
| V-kanal kalan kalınlık | denetçi en az 0,5; test 0,8 ± 0,1 | 0,7–0,8 (Alucobond 0,8; Alucolux 0,8); masa yüzeyinden ölçülür | **varsayılan 0,8, en az 0,7** (denetçi kuralı 17 de 0,7) | uyumlu |
| V-kanal takımı | V uç 90°/135° | 90°, 108°, 135°, 155°; düz taban (Dibond ≥ 3,2 mm) | 90°/135° ilk sürüm; takım profiline uç düzlüğü | uyumlu |
| Devir | makine aralığı + kesme hızı bandı (uyarı) | alüminyum 183–305 m/dk; Ø10–Ø12'de 12 000–15 000 rpm | uyarı bandı 183–305 m/dk | doğrulanacak |
| Köprü (ACM 4 × 6 × 1; alüminyum 4 × 5 × 0,8) | analiz | sayı yok; "ince köprü + çapak alma" | aynı | doğrulanacak |
| İnce tabaka alüminyum 0,1–0,3 | analiz | sayı yok | aynı | doğrulanacak |
| Finiş payı 0,2 mm | analiz | "bitiş pasosu gerekir", sayı yok | aynı | doğrulanacak |
| Parça arası Ø + 3, en küçük kenar 20 mm | analiz | sayı yok | aynı | doğrulanacak |
| Gagalama ≤ 1 × Ø, ısınma ≥ 3 s, mengene + 5 mm | analiz | sayı yok | aynı | doğrulanacak |
| Plaka ölçüleri (alüminyum 1000×2000, 1250×2500, 1500×3000; ACM 1250×3200, 1500×3200, 1250×2440) | analiz | alüminyum aynı ("doğrulanmalı"); ACM yok | aynı | doğrulanacak |

## 5. Ekranlar: ne görünür, ne kaybolur

Masaüstü önce. Her ekran dört iş malzemesi için anlatılır. "Ahşap" ve "Plastik" sütunları bugünküyle aynıdır; yazılanlar yalnız karşılaştırma içindir.

### 5.1 Adım 1: Makine ve plaka

Malzeme seçici grupları:

```
Malzeme  [ MDF 18 mm                    v ]
  Ahşap      MDF · Kontrplak · Melamin kaplı sunta · Masif ahşap
  Plastik    Akrilik · PVC
  Kompozit   Alüminyum kompozit panel (ACM)
  Metal      Alüminyum · Pirinç (yakında)
  ---------  Mermer / taş (yakında) · Çelik (desteklenmez)
```

| Alan | Ahşap | Plastik | ACM | Alüminyum |
| --- | --- | --- | --- | --- |
| Kalınlık hazırları | bugünkü | bugünkü | 3 · 4 · 6 | 1 … 10 |
| Plaka ölçüsü | bugünkü | bugünkü | 1250×3200 … | 1000×2000 … |
| Yön kadranı | "Damar açısı" | yok | "Film oku yönü" + not: "Ok yönlüdür: 30° ile 210° farklıdır." | "Yüzey yönü" kapalı gelir; "Fırçalı / eloksallı yüzeyde açın." |
| İşlenen yüz | yok | yok | "Arka yüzden işle (parçalar aynalanır)" açık | "Ön yüz / Arka yüz" |
| Makine uygunluğu | yok | yok | yok | hata kutusu (aşağıda) |
| Tutma ipucu | yok | yok | "Yüz aşağı, film üstünde kalsın." | "Vakum tek başına tutmaz: mengene veya bant kullanın." |

Alüminyum seçilip makine metal beyanı vermemişse adım 1 hata kutusu (bugünkü "kesim ayarı yok" kutusuyla aynı kalıp):

```
Bu makine alüminyum için tanımlı değil.
Alüminyum kesmek için makinede soğutma ve tutma bilgisi gerekir.
[ Makineyi düzenle: Metal kesim ]     DXF ve PDF yine alınabilir.
```

Önizlemede plaka rengi: ACM düz renk, alüminyum açık gri metalik.

### 5.2 Adım 2: Parçalar tablosu

| Sütun / araç | Ahşap | Plastik | ACM | Alüminyum |
| --- | --- | --- | --- | --- |
| "Damar" sütunu | var | bugünkü | başlık "Ok yönü" | başlık "Yüzey yönü"; plaka yönü kapalıysa sütun gizli |
| "Kenar bandı (mm)" | var | bugünkü | gizli | gizli |
| "Dolap ekle" | var | bugünkü | gizli | gizli |
| Toplu düzenleme → damar | var | bugünkü | "Ok yönü" | "Yüzey yönü" |
| Yapıştırma eşlemesi | bugünkü | bugünkü | bant sütunları yok sayılır, bilgi satırı | aynı |
| Küçük parça uyarısı | yok | yok | yok | kenarı 20 mm altı parça satırında hata |

Malzeme ahşaptan metale değişirse ve parçalarda kenar bandı varsa: değer silinmez, kullanılmaz; üstte bilgi: "Kenar bandı bu malzemede kullanılmaz; ölçüler kesim ölçüsü sayılır." Ölçü modu "kesim ölçüsü"ne döner (bitmiş ölçüden bant düşme çalışmaz).

### 5.3 Adım 2: Çizim tahtası

- ACM: işlem listesine **"V-kanal (büküm)"** gelir. Açık çizgiye ve iç kontura atanır. Özellikler paneli:

```
İşlem        [ V-kanal (büküm)  v ]
Takım        T5 V uç 90°, uç 3 mm
Kalan kalınlık   0,8 mm   (0,5–1,2)
Kanal genişliği  9,4 mm   (hesap)
```

  Kanal tuvalde çift çizgi (genişlik kadar) ve kesikli orta eksenle çizilir. DXF içe aktarmada katman eşlemesine "V-kanal" seçeneği eklenir.
- ACM ve alüminyum: "arka yüzden işle" açıkken tuval başlığında rozet: "Ön yüzden çiziyorsunuz · makinede aynalanır".
- Alüminyum: iç köşe notu aynı ("Köşeler R3 kalır"); dogbone kalır. "Oyma (çizgi üzerinden)" kalır; derinlik tavanı paso tavanına uyar. Parça damarı alanı "Yüzey yönü" adını alır.
- Ahşap ve plastik: değişmez.

### 5.4 Adım 3: Dizilim

| Öğe | Ahşap | Plastik | ACM | Alüminyum |
| --- | --- | --- | --- | --- |
| Yön çizgileri | damar çizgisi | yok | ok (yönlü) | ince fırça çizgisi (yön açıksa) |
| Parça dönüşü | g ve g + 180° | serbest | yalnız g (sabit parçada) | g ve g + 180° |
| Parça arası boşluk | takım Ø + 0,1 | aynı | aynı | takım Ø + 3, alt sınır takım Ø + 1 |
| Kenar payı | 10 | aynı | 10 | mengenede varsayılan 25; altına inince uyarı "mengene bölgesi" |
| Aynalama rozeti | yok | yok | "Arka yüz görünümü" | yüz seçimine göre |
| Artık parça | tür + kalınlık | aynı | + renk kodu, ok yönü saklanır | + alaşım |
| Mod "en hızlı üretim" | bugünkü | bugünkü | bugünkü | kesim sırası içten dışa |

### 5.5 Adım 4: Simülasyon ve Kesim ayarları

Kesim ayarları paneli bölümleri:

| Bölüm | Ahşap / Plastik | ACM | Alüminyum |
| --- | --- | --- | --- |
| Köprü (tab) | bugünkü | varsayılan 4 × 6 × 1 | "Her parçada" kilitli; 4 × 5 × 0,8; ince tabaka seçeneği |
| Dalma (konturda) | Dik dalma / Rampa | aynı | "Rampa" kilitli; açı 2° (0,5–5); açıklama: "Metalde dik dalma takım kırar." |
| Devir ve ilerleme | bugünkü | bugünkü | talaş yükü satırı öne çıkar; bant dışı = hata |
| **Soğutma** (yeni) | yok | yok | "Sis (M7)" / "Hava" / "Elle açacağım"; kapalı seçilemez |
| **Finiş pasosu** (yeni) | yok | yok | açık, pay 0,2 mm, ilerleme %60 |
| **V-kanal** (yeni) | yok | kalan kalınlık, takım | yok |
| Paso | bugünkü | bugünkü | "3 mm → 3 paso × 1 mm"; tavan: "En çok 1,5 mm (takım Ø6 × 0,25)" |

Alüminyumda talaş yükü satırı:

```
T3 Ø6 tek ağız   Devir 18 000   İlerleme 900 mm/dk   Talaş yükü 0,050 mm/diş  [uygun]
                                                      0,02 – 0,10 arası olmalı
```

Simülasyon: V-kanal V kesitli çizilir; finiş pasosu ayrı renkte; soğutma açık/kapalı durumu oynatma çubuğunda simgeyle. 3D: alüminyum metalik (pürüz 0,35, metallik 0,8), ACM yarı mat düz renk. Basit modda düz gri.

### 5.6 Adım 5: Dışa aktar

Kontrol listesine malzemeye göre maddeler eklenir (hepsi işaretlenmeden indirme yok):

- ACM: "Panel yüzü aşağı, film üstünde." · "V uç takılı: T5, 90°." · "Kalan kalınlık 0,8 mm; önce fire parçada deneyin."
- Alüminyum: "Soğutma hazır (sis / hava)." · "Sac mengene veya bantla sıkıldı; mengeneler kenar payı içinde." · "Gözlük takılı, talaş koruması kapalı." · "Toz emme ahşap tozundan temizlendi veya kapalı." · "Bu makinede alüminyum test kesimi yapıldı." (yapılmadıysa dosya başına "DOĞRULANMADI" ve ayrı kabul).

G-code başlığına satırlar: `MALZEME: ALUMINYUM 5754 3 MM`, `SOGUTMA: SIS M7`, `GIRIS: RAMPA 2`, `FINIS: 0.2`.

### 5.7 Makineler formu

Yeni bölüm **"Metal kesim"** (kapalı gelir; açılmadan metal işi dosya vermez):

```
[x] Bu makine alüminyum kesebilir
Soğutma        ( ) Yok  (•) Sis  ( ) Sıvı  ( ) Hava üfleme
Soğutma kontrolü  (•) Programdan   Aç kodu [M7]  Kapat kodu [M9]
                  ( ) Elle (program durur ve sorar)
Makine sertliği   ( ) Hafif (kayış / kremayer)  (•) Orta  ( ) Sağlam (vidalı mil, döküm gövde)
Mengene yüksekliği  [ 25 ] mm     (güvenli Z bundan en az 5 mm yüksek olmalı)
```

- Vakum kodu `M7` ise ve soğutma eklenirse hata: "Vakum M7 kullanıyor. M7 soğutma kodudur. Vakum kodunu değiştirin ya da vakumu elle açın."
- Takım tablosu: V uçta iki yeni alan: "Uç açısı (°)", "Uç düzlüğü (mm)". Takım tipi adları aynı; tek ağızlı freze = "Düz freze, 1 ağız".
- Parametre tablosu: tür sütununda yeni türler. Metal satırında ek hücreler: "Soğutma", "Finiş payı". Talaş yükü hücrede hesaplanır ve bant dışıysa kırmızı olur. "Kesim ayarı ekle" metalde ahşap başlangıç değerlerini **kullanmaz**; aileye göre ihtiyatlı değerle ve "doğrulanmadı" işaretiyle açar.
- Doğrulama sayfası: durum aile başına gösterilir: "Ahşap plaka: Doğrulanmış · Kompozit: Test yok · Alüminyum: Test yok".

### 5.8 Ayarlar → Malzemeler

- Tür seçici dört gruplu. Ton listesine "alüminyum", "gümüş metalik", "pirinç" eklenir.
- ACM girdisi: renk kodu, metalik (evet/hayır), yüzey sacı kalınlığı. Alüminyum girdisi: alaşım, temper, yüzey, film.
- Yön alanı adı türe göre değişir. Hazır plaka ölçüleri türe göre dolar.
- Yeni şirket tohumuna metal eklenmez; kullanıcı kendi ekler.

### 5.9 Etiket ve PDF

- Etiket: bant kenar çizgileri yalnız ahşapta. ACM: film oku, "YÜZ AŞAĞI KESİLDİ", "Büküm: 4". Alüminyum: yön oku (açıksa), "Çapak alınacak".
- PDF: başlıkta malzeme adı ve alaşım. Kesim özeti tablosunda "Soğutma", "Giriş", "Finiş" satırları. ACM yerleşim sayfasında V-kanallar kesikli çizgi, açıklamada "V-kanal (büküm)". Metalde güvenlik kutusu: "Metal işi: gözlük, sıkma ve soğutma kontrolü yapılmadan başlatmayın."
- DXF dışa aktarma: V-kanal katmanı `VKANAL`.

### 5.10 Saha kiti ve yardım

- Saha kiti aileye göre test parçası verir. ACM: 200×200 tepsi, dört kenarda 25 mm büküm; ölçülecekler: kalan kalınlık, büküm sonrası dış ölçü. Alüminyum: 80×80 kare, Ø20 delik, 2 mm kör cep; tolerans ±0,1 mm; önce air cut zorunlu.
- Yardım: "Metal kesimi" sayfası: hangi makine yapar, takım seçimi, soğutma, sıkma, ilk kesimde ne izlenir, ne zaman durdurulur. Çelik neden yok.

## 6. Makine tarafı

### 6.1 Profilin beyan etmesi gerekenler

Hepsi isteğe bağlı alanlardır; profil şema sürümü 1 kalır, eski profiller geçerlidir.

| Alan | Neden |
| --- | --- |
| `metal.enabled` | Açık beyan. Yoksa demir dışı metal işi `MATERIAL_NOT_ALLOWED_ON_MACHINE` ile durur. ACM bu beyanı istemez. |
| `coolant { type, control, on, off }` | `none / mist / flood / air`; `program` (M kodu) veya `manual` (program durur, mesaj yazar). Alüminyumda `none` olamaz. |
| `metal.rigidity` | `light / standard / heavy`. Paso tavanını ölçekler: 0,25 / 0,5 / 1,0 × Ø. Tablo değerinden gevşek olamaz. Doğrulanacak. |
| `holdDown.clampHeight` | Mengene yüksekliği. `safeZ ≥ clampHeight + 5` şartı. Mengeneye çarpma metal işinin klasik kazasıdır. |
| Spindle `minRpm`, `powerKw` | Zaten var. Alüminyumda kesme hızı bandı bundan hesaplanır. Düşük devirde tork olmadığı için alt devre yakın setlere uyarı. |
| Takım: V uç `angleDeg`, `tipDiameter` | V-kanal genişliği ve derinlik hesabı. |
| Takım tutucu (pens tipi) | Bilgi alanı; kural yok. ER pensli spindle önerilir notu. |
| En yüksek kesme beslemesi | Bugün profil genel sınırı kullanılıyor (`machineFeedLimits`). Metalde alt sınır önemli; ayrı alan gerekmez. |

### 6.2 M7 çakışması ve çözümü

- Bugün örnek profiller vakumu `M7` ile açar, `M9` ile kapatır. Standartta `M7` sis, `M8` sıvı, `M9` ikisini kapatır.
- Tehlike: soğutma `M8/M9` ile eklenirse, takım değişiminde yazılan `M9` vakumu da kapatır. Parça yerinden oynar.
- Çözüm (profil doğrulamasında, yalnız soğutma tanımlıysa çalışır):
  1. Vakum ve soğutma kodları ayrı olmalıdır; hiçbir kod iki işte kullanılamaz (`mCodeConflict`).
  2. Soğutma `program` ise vakum `M7`, `M8`, `M9` kullanamaz. Kullanıcı vakuma makinenin gerçek çıkış kodunu yazar (ör. `M10/M11`) ya da vakum kodlarını boş bırakır (elle açar).
  3. Mevcut profiller soğutma tanımlamadığı için **hiç etkilenmez**; goldenlar değişmez.
- Sahada sorulacak: test makinesinde vakum gerçekten `M7`'ye mi bağlı? (`docs/machines/<makine>/` bilgi listesine eklenir.)

### 6.3 Post değişiklikleri

- Post ayarına isteğe bağlı `coolant { enabled }` gelir (vakumla aynı kalıp; kodlar profilden okunur). Varsayılan kapalı.
- Açık olduğu yeni post sürümleri: `mach3` 1.1.0 ve `generic` 1.1. Kendi golden dosyalarıyla. **1.0.0 sürümleri ve goldenları dondurulmuş kalır.** Mevcut makineler eski sürüme bağlı kaldığı için çıktıları değişmez.
- Sıra: spindle aç → ısınma beklemesi → soğutma aç → ilk dalma. Takım değişimi ve her duraklamadan önce soğutma kapat. Program sonunda: güvenli Z → spindle kapat → soğutma kapat → vakum kapat → bitiş kodu.
- `manual` soğutmada: ilk kesimden önce `M0` ve mesaj "SOGUTMAYI ACIN"; sonda mesaj "SOGUTMAYI KAPATIN".
- Syntec ve NcStudio postları yazılırken aynı alan kullanılır; yeni kural gerekmez.

## 7. Yeni güvenlik kuralları (bağımsız denetçi)

Hepsi malzeme davranış tablosuna bağlıdır. Ahşap ve plastikte hiçbiri devreye girmez. Hepsi **hata**dır (dosya indirilemez), aksi yazılmadıkça. Denetçi sınırı tablodan alır, ölçümü okunan G-code'dan yapar. Aynı sınırlar önce doğrulamada (ekranda, erken) ve takım yolunda da uygulanır; denetçi son kapıdır.

| No | Kod | Kural | Gerekçe |
| --- | --- | --- | --- |
| R11 | `COOLANT_NOT_ON` | Soğutma şart ve programdan ise: her spindle açılışından sonra, ilk kesim hareketinden önce soğutma açık olmalı. | Kuru alüminyumda talaş takıma kaynar, takım saniyeler içinde kırılır. |
| R11 | `COOLANT_ON_AT_PAUSE`, `END_COOLANT_ON` | Takım değişimi, duraklama ve program sonunda soğutma kapalı olmalı. | Operatör elini uzattığında sis püskürmemeli; sonda açık kalan soğutma tablayı ıslatır. |
| R11 | `COOLANT_PROMPT_MISSING` | Soğutma elle ise ilk kesimden önce `M0` ve mesaj olmalı. | Elle soğutma unutulur; program sormadan başlamamalı. |
| R12 | `STRAIGHT_PLUNGE_IN_METAL` | Malzemeye giren her inişin açısı tablo sınırını (5°) aşamaz. İstisna: matkap takımıyla delme. | Freze ucu dik dalmada talaş atamaz; yanal yük takımı kırar. Merkezden kesmeyen frezede uç doğrudan ezilir. |
| R12 | `PECK_MISSING` | Matkapla delmede her gagalama en çok 1 × Ø, arada talaş boşaltma çıkışı. | Alüminyum talaşı delikte sıkışır, matkap kopar. |
| R13 | `STEP_DOWN_ABOVE_LIMIT` | Aynı işlemde ardışık iki kesim seviyesi arasındaki fark ≤ tavan (tablo × makine sertliği × takım Ø). | Derin paso hafif köprüde titreşim, takım kırılması ve parçanın sökülmesi demektir. |
| R14 | `CHIP_LOAD_ABOVE_LIMIT` | F / (S × ağız) tablo üst sınırını aşamaz. | Fazla talaş yükü takımı kırar; kırık parça fırlar. |
| R14 | `CHIP_LOAD_BELOW_LIMIT` | F / (S × ağız) alt sınırın altına inemez (besleme tabanı). | Takım kesmez, sürter: ısınır, talaş kaynar, sonra kırılır. Metalde "yavaş gitmek güvenli" değildir. |
| R15 | `PART_NOT_HELD` | Demir dışı metalde boydan boya kesilen her dış kontur ve her iç parça (düşen parça) köprü veya ince tabaka ile tutulmalı. Denetçi son seviyede köprü yükselişlerini sayar: en az 2, çevre 600 mm üstünde en az 3. | Serbest kalan metal parça takıma takılır ve fırlar. Vakum küçük ve pürüzsüz metal parçayı tutamaz. |
| R15 | `PART_TOO_SMALL` | En küçük kenar tablo sınırının (20 mm) altındaysa kesilmez. | Köprü sığmaz; parça tutulamaz. |
| R16 | `TOOL_TYPE_FORBIDDEN` | Malzemenin izin vermediği takım tipi kesim yapamaz (metalde sıkıştırma ve küresel; kontur kesiminde V uç). | Sıkıştırma freze ahşap içindir; metalde talaşı içeri bastırır ve kırılır. |
| R17 | `VGROOVE_TOO_DEEP` | ACM'de V uç hiçbir noktada −(kalınlık − en az kalan) altına inemez. En az kalan tablo değeridir (0,7 mm, §4.5), kullanıcı ayarından bağımsız. | Ön yüz sacı kesilirse panel hurda olur; büküm yerinden kopar. |
| R17 | `VGROOVE_WRONG_TOOL` | V-kanal yalnız V uçla, kontur kesimi yalnız düz frezeyle yapılır. | Düz frezeyle açılan kanal bükülmez; V uçla boydan kesim ucu kırar. |
| R17 | `VGROOVE_MISSING` | Projedeki her büküm çizgisinin kanalı programda olmalı (LAYOUT kalıbı). | Eksik kanal bükümde fark edilir; panel hurda. |
| R18 | `SAFE_Z_BELOW_CLAMPS` | Mengene tutmada XY rapid yüksekliği ≥ mengene yüksekliği + 5 mm. | Mengeneye rapid çarpması takımı ve spindle'ı kırar. |
| R18 | `CUT_IN_CLAMP_ZONE` (uyarı) | Kesim, plaka kenarına mengene payından yakınsa uyarı. | Mengenenin yeri bilinmez; yalnız uyarılabilir. |
| R4 ek | `WARMUP_MISSING` (genişler) | Metalde her spindle açılışından ve her devir değişiminden sonra bekleme olmalı (en az 3 s). | Spindle hedef devire çıkmadan kesim = anlık çok yüksek talaş yükü. |
| R10 ek | `UNVERIFIED_FAMILY_HEADER_MISSING` | Makinede o malzeme ailesi için test kesimi kaydı yoksa dosyada "DOGRULANMADI" yorumu ve indirmede ayrı kabul. | MDF ile doğrulanmış makine alüminyumda doğrulanmış değildir. |
| R7 ek | `VACUUM_OFF_MID_PROGRAM` | Vakum program bitmeden kapanamaz (her malzemede; bugün ihlal eden çıktı yok). | M kodu çakışması bu hatayı üretir; parça oynar. |

Doğrulama (ekranda, dosyadan önce) için karşılık gelen kodlar: `MATERIAL_NOT_ALLOWED_ON_MACHINE`, `COOLANT_REQUIRED`, `ENTRY_RAMP_REQUIRED`, `STEP_DOWN_ABOVE_MATERIAL_LIMIT`, `CHIP_LOAD_OUT_OF_RANGE`, `TOOL_TYPE_UNSUITABLE_FOR_MATERIAL`, `PART_TOO_SMALL_FOR_HOLD_DOWN`, `VGROOVE_DEPTH_INVALID`, `VGROOVE_TOOL_MISSING`, `EDGE_BAND_IGNORED` (bilgi), `SLOT_TOO_DEEP` (uyarı: kanal derinliği > 3 × Ø, talaş sıkışır).

Bilinçli olarak kural yapılmayanlar: mengenenin gerçek yeri (bilinemez), soğutmanın gerçekten akıp akmadığı (görülemez), alaşımın doğru girildiği. Bunlar kontrol listesi maddesi ve yardım metnidir.

## 8. Veri modeli ve uyumluluk

### 8.1 Veritabanı

| Değişiklik | Tür | Not |
| --- | --- | --- |
| `materials.kind` yeni değerler (`acm`, `aluminium`) | göç yok | Serbest metin; core doğrular. |
| `materials.props jsonb not null default '{}'` | eklemeli göç | Alaşım, temper, renk kodu, metalik, film. |
| `materials.tone` yeni değerler | göç yok | Serbest metin; core listesi genişler. |
| `offcuts.props jsonb default '{}'` | eklemeli göç | Alaşım / renk kodu; eşleşmede tür + kalınlık + (varsa) alaşım veya renk. |
| `offcuts.grain` | aynı | Yön açısı olarak kullanılır; yönlü malzemede 0–359 saklanabilir (sütun zaten tam sayı). |
| `validations.material_family text null` | eklemeli göç | `null` = bugünkü kayıtlar = ahşap plaka ailesi. |
| `machine_profile_versions` profil JSON'u | göç yok | Yeni alanlar isteğe bağlı. |

### 8.2 Proje JSON'u

Öneri: **şema sürümü 2 kalır.** Bütün yeni alanlar isteğe bağlıdır; repo şimdiye kadar isteğe bağlı alanları sürüm artırmadan ekledi (T015, T307, T323, T324). Sürüm artırmak her fixture'ı ve göç yolunu oynatır; saha testi öncesi gereksiz risktir.

Yeni isteğe bağlı alanlar:

- `stock.machinedFace: 'front' | 'back'` (yoksa `front`).
- Parça `grain.flip: true` (yalnız yönlü malzemede anlamlı).
- `cutting.coolant: 'mist' | 'flood' | 'air' | 'manual'`.
- `cutting.finish: { allowance, feedFactor? }`.
- İşlem türü `vgroove` (`{ kind: 'vgroove', remaining? }`), açık çizgi ve iç konturda.
- `cutting.tools.vgroove` (işlem başına takım).

Sürüm 3'e ancak yön açısı 0–360 aralığına taşınırsa gerek olur. Önerilmez; `flip` aynı işi eklemeli yapar.

### 8.3 Bayt bayt aynı kalanlar ve bunu neyin garanti ettiği

- Mevcut altı tür ve bilinmeyen tür için takım yolu, G-code, DXF, PDF, etiket.
- Garanti: (1) davranış tablosu bugünkü sabitleri taşır, anlık görüntü testiyle kilitli; (2) yeni alanlar yokken kod eski yoldan gider; (3) post 1.0.0 dosyaları ve goldenları dondurulmuş; (4) yeni denetçi kuralları tabloya bağlı, ahşapta kapalı; (5) her M-Metal görevinin kabulünde "mevcut goldenlar bayt bayt aynı" maddesi var; (6) metal için goldenlar yeni fixture'larla, yeni dosyalar olarak eklenir ve `needs-human` etiketi alır.
- Görünen tek değişiklik (bayrak kapalıyken): yok. Yeni türler `release: 'flagged'` ile gelir; bayrak (`NITTCAM_METAL`, sonra şirket ayarı) açılmadan menülerde çıkmaz.

## 9. Riskler, makine testleri ve insan kapıları

### 9.1 Riskler

| Risk | Etki | Önlem |
| --- | --- | --- |
| Yanlış alüminyum değeriyle takım kırılması, parça fırlaması | yaralanma, makine hasarı | Sınırlar tabloda ve denetçide; makine beyanı; aile başına test kesimi; kontrol listesi; "garantili" denmez (§7.3). |
| Saha testi 1'in gecikmesi veya bozulması | ana hedef kayar | Saha testinden önce yalnız T340–T342. Diğer her şey sonra. Goldenlar her görevde kilitli. |
| M7 çakışması yüzünden vakumun düşmesi | parça oynar | Profil doğrulaması + `VACUUM_OFF_MID_PROGRAM`. |
| Sayıların yanlış olması (talaş yükü bandı, paso tavanı, 0,8 mm) | ya fazla kısıt ya az kısıt | Araştırma dosyasıyla hizalama (T340 kabul maddesi); test kesimi; değerler tabloda tek yerde. |
| Alaşım farkı (5754 ile 6082 aynı sette) | kötü yüzey, sıvanma | İlk sürüm: proje beslemesi. Sonra: sete isteğe bağlı `variant`. Açık konu. |
| ACM'de ön yüz yerine arka yüzün çizilmesi | ters parça | "Arka yüzden işle" varsayılan açık, her ekranda rozet, etikette yazı, test parçası asimetrik. |
| Sis soğutma + MDF fire tabla + ahşap tozu | şişen tabla; alüminyum tozu ve ahşap tozu aynı emişte (yangın riski, doğrulanacak) | Yardım ve kontrol listesi maddesi; hava üfleme seçeneği. |
| Kapsam kayması (büküm payı hesabı, kaset açınımı, yazı oyma) | iş büyür | Açınım kullanıcının DXF'inden gelir; büküm payı hesabı ve oyma M-Metal dışında. |
| Sorumluluk | hukuki | §13.5 kullanım şartlarına metal maddesi; hukuk görüşü insan kapısı. |

### 9.2 Kademe başına makine testi (insan kapısı)

| Kademe | Test | Geçmeden yayınlanamayan |
| --- | --- | --- |
| A1 ACM kesim | Air cut; 3 ve 4 mm panelde kare, daire, iç kesim, köprülü küçük parça; ölçü ±0,2 | ACM için NC indirme (bayrak kapalı kalır) |
| A2 V-kanal | Fire parçada kalan kalınlık ölçümü (0,8 ± 0,1); 90° büküm; tepsi parçası; ön yüzde iz yok | V-kanallı NC |
| B alüminyum | Air cut; 3 mm 5754 ve 6 mm 6082'de 80×80 test parçası; rampa, cep, delik, köprü; takım ve yüzey gözlemi; ±0,1; soğutma kodlarının makinede doğru çıkışı sürdüğü | Alüminyum için NC indirme; "Metal kesim" bölümünün müşteriye açılması |
| C pirinç | Ayrı test | Pirinç türü |

Testten önce de yapılabilenler: bayrak açıkken ekranlar, simülasyon, DXF ve PDF. **NC dosyası yalnız geliştirici bayrağıyla** alınır; müşteriye açılmaz.

### 9.3 Sahibin vermesi gereken kararlar

1. Kademe kapsamı ve sırası: A1 → A2 → B → C; D hiç. (Öneri bu.)
2. Metal testi için makine ve malzeme: hangi makine, V uç ve tek ağızlı freze var mı, sis soğutma var mı?
3. Test makinesinde vakum gerçekten `M7` mi? Soğutma çıkışı var mı, hangi kod?
4. Alüminyumda soğutmasız (yalnız hava) kesime izin verilsin mi? Öneri: evet, "hava" seçeneğiyle ve daha sıkı sınırla.
5. "Metal kesim" beyanı kullanıcı beyanı olarak yeterli mi, yoksa NittCam onayı mı gerekir? Öneri: beyan + aile test kesimi + her dosyada kabul.
6. Plastikte kenar bandı sütunlarının gizlenmesi (saha testinden sonra).
7. Hukuk: kullanım şartlarına metal maddesi ve sorumluluk sınırı.
8. Metal desteği hangi pakette (fiyatlama; insan kapısı).

## 10. Spec değişiklik önerisi (metin)

Spec doğruluk kaynağıdır. Aşağıdaki metinler T340 ile işlenir.

- **§2.2 Hedef kitle**, tabela satırı: "V-oyma, yazı aracı ve serbest şekilli cep yok" → "Alüminyum kompozit panelde kontur kesimi ve V-kanal (büküm); yazı V-oyması, yazı aracı ve serbest şekilli cep yok". Yeni satır: "Alüminyum sac işleyen fason atölyeler | 1–10 mm alüminyumda kontur, cep, delik; metal beyanı yapılmış makinede | Çelik ve paslanmaz yok; 3D yüzey yok".
- **§2.5 Başlangıçta dışarıda**: "V-oyma, yazı aracı…" → "Yazı V-oyması, yazı aracı, serbest şekilli cep boşaltma (V-kanal büküm kapsamda, §6.3)". Yeni madde: "Çelik, paslanmaz ve titanyum (kalıcı olarak dışarıda; router buna uygun değil)". Yeni madde: "Büküm payı hesabı ve kaset açınımı (açınım çizimden gelir)".
- **§3.6 Plaka adımı**, Malzeme: "ahşap (…), plastik (…), kompozit (alüminyum kompozit panel), metal (alüminyum; pirinç yakında). Mermer/taş 'yakında'. Çelik desteklenmez." Yeni madde: "**Malzeme davranışı:** her malzeme türü bir davranış tablosu satırıdır (yön, işlenen yüz, kenar bandı, izinli takım, soğutma, giriş, paso ve talaş yükü sınırı, köprü, finiş). Ekranlar, takım yolu ve denetçi bu tabloyu okur." Damar maddesi: "**Yön:** ahşapta damar (yönsüz), alüminyumda yüzey/hadde yönü (yönsüz, varsayılan kapalı), kompozit panelde film oku (yönlü: 180° farklıdır). Aynı kadran ve aynı alan kullanılır." Yeni madde: "**İşlenen yüz:** kompozit panel arka yüzden işlenir; parçalar aynalanır ve her ekranda belirtilir."
- **§4.1 / §4.8**: "Damar ve kenar bandı sütunları malzeme davranışına göre görünür; kenar bandı yalnız ahşap plakada (ve bugünkü haliyle plastikte) vardır."
- **§6.2 Damar kuralı**na ek: "Yönlü malzemede sabit parça yalnız g açısında yerleşir (g + 180° yok)." Boşluklar: "Varsayılan parça arası pay malzemeye göre gelir (alüminyum: takım Ø + 3 mm)."
- **§6.3 Takım yolu**: İşlem türlerine "V-kanal (V uçla, kalan kalınlık bırakarak; yalnız kompozit panel)". Giriş/çıkış: "Demir dışı metalde giriş her zaman rampa veya helistir; dik dalma yalnız matkapla." Yeni madde: "**Finiş pasosu:** kaba pasolar konturdan pay kadar uzakta kesilir, son paso payı alır (alüminyumda varsayılan açık)." Küçük parça: "Demir dışı metalde her parça köprü veya ince tabaka ile tutulur." Yeni madde: "**Soğutma:** takım yolu modeli soğutma aç/kapa olaylarını taşır."
- **§6.4 Post**: listeye "Soğutma (sis/sıvı/hava) aç ve kapat; elle soğutmada duraklama ve mesaj".
- **§7.1 Makine profili** tablosuna satırlar: "Soğutma | Yok / sis / sıvı / hava; programdan (M kodları) veya elle" ve "Metal kesim | Beyan; makine sertliği; mengene yüksekliği". Takım profili: "V uçta uç açısı ve uç düzlüğü". Not: "Vakum ve soğutma kodları çakışamaz."
- **§7.2 G-code güvenlik kuralları**na ek (11–18): bölüm 7'deki tablo, kısa haliyle. Giriş cümlesi: "11–18 arası kurallar malzeme davranışına bağlıdır; ahşap ve plastikte devreye girmez."
- **§7.3 Doğrulama**: "Doğrulama ayrıca **malzeme ailesine** bağlıdır (ahşap plaka, plastik, kompozit, demir dışı metal). Bir ailede doğrulanan makine diğerinde doğrulanmış sayılmaz. Aileye göre test parçası: …"
- **§9.1**: `materials` satırına "özellikler (alaşım, renk kodu, film)"; `offcuts` satırına "özellikler"; `validations` satırına "malzeme ailesi".
- **§9.2**: isteğe bağlı alanlar listesi (bölüm 8.2).
- **§11 Test stratejisi**: "Metal fixture'ları için ayrı golden dosyalar; mevcut goldenlar M-Metal boyunca bayt bayt aynı kalır."
- **§12.1 Milestone**: "M-Metal: saha testi 1'den sonra; çıkış: ACM tepsi parçası ve alüminyum test parçası makinede kesildi ve ölçüler tolerans içinde."
- **§14.1 Riskler**: bölüm 9.1'in ilk dört satırı. **§14.2 Açık maddeler**: bölüm 9.3. **§14.3 Sonraki sürümler**: "Pirinç ve bakır; yazı V-oyması; büküm payı hesabı".

## 11. Karar kaydı önerisi (`docs/DECISIONS.md` için)

Kaydedildi: **D-118** (kapsam ve kurallar, 2026-11-23) ve **D-130** (MB1–MB4 saha testinden önce, görünürlük ve NC, 2026-11-28). Aşağıdaki metin özgün öneridir.

```
## D-xxx Metal is added through a material traits table; ACM first, aluminium second, steel never (2026-11-23, owner decision; CTO analysis docs/metal/metal-analizi.md)
- Owner: metal becomes part of the product. Field test 1 (wood, MDF, Mach3) stays first and must not be put at risk.
- Scope in tiers: A1 aluminium composite panel (cut), A2 ACM V-groove for folding, B aluminium sheet and plate (1–10 mm; contour, pocket, hole), C brass later (copper "yakında"), D steel and stainless permanently out (spindle rpm/torque, rigidity, flood coolant, sparks with wood dust).
- Model: one `MaterialTraits` row per material kind in `packages/core` (family, direction none/axial/directed, machined face, edge band, tool types per operation, coolant, entry, step-down and chip-load limits, tabs, skin, finish pass, spacing, look, label fields, verification family). UI, validation, toolpath and the independent G-code check read it. No `if metal` branches.
- Existing kinds keep today's constants in the table; unknown kinds keep today's behaviour; every new project, profile and post field is optional. Golden files of existing materials stay byte-identical through the whole milestone; metal gets new fixtures and new golden files (`needs-human`).
- Direction: one concept and the same fields for wood grain (axial), aluminium surface/rolling direction (axial, off by default) and ACM film arrow (directed: only one rotation fits). Labels differ per material.
- Machine: a profile must declare metal cutting (coolant type and control, rigidity, clamp height) before a non-ferrous job gives NC. Vacuum and coolant M codes must not collide (today's example profiles use M7 for vacuum; M7/M8/M9 are coolant codes). Coolant is written only by new post versions; 1.0.0 posts and goldens stay frozen.
- Safety: checker rules R11–R18 (coolant on before cutting, no straight plunge in metal, step-down and chip-load limits as errors incl. a feed floor, every part held, forbidden tool types, V-groove never through the face skin, safe Z above clamps) plus verification per material family.
- Gates: each tier needs its own machine test by the owner before NC for that tier is released to users; until then the kinds are behind a flag.
- Order: before field test 1 only T340–T342 (docs, traits table with identical output, consumers read traits). Everything else after.
```

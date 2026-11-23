# Malzeme başına başlangıç kesim değerleri: kaynak araştırması

> Durum: **araştırma notu**. Kod, şema ve golden dosya değişmedi. Hazırlayan: araştırma ajanı, 2026-11-23.
> Amaç: MDF, kontrplak, melamin, masif ahşap, akrilik ve PVC için (ve aday malzemeler alüminyum, alüminyum kompozit panel, pirinç, bakır için) yayımlanmış ve atıf yapılabilir başlangıç kesim değerlerini toplamak. Geliştirici bu belgeden yerleşik "başlangıç değerleri" üretecek. Bu değerler arayüzde her zaman **doğrulanmamış** olarak görünür ve operatör onları makinede onaylar (D-045, D-046, `unverified`).
> İlgili kod: `packages/core/src/machine/defaults.ts`, `material-kinds.ts`, `profile.ts` (`materialParamsSchema`, `toolTypeSchema`), `packages/core/src/toolpath/spindle.ts` (`chipLoad = feed / (rpm × flutes)`), `packages/core/src/toolpath/build.ts` (`rampAngleDeg: 3`), `packages/core/src/toolpath/tabs.ts` (`TAB_DEFAULTS`).

**Gösterim kuralları**

- `[Sn]` §e'deki kaynak listesinin n numaralı kaydıdır. Kaynaktan gelen her sayının yanında kaynak etiketi durur.
- **(T)** = türetilmiş değer. Kaynakta doğrudan yazmıyor; formülle (feed = chip load × flutes × rpm, rpm = vc × 1000 / (π × D)) ya da iki kaynak değeri arasında ara değer olarak bu belgede hesaplandı.
- **(Ö)** = bu belgenin önerisi (mühendislik yargısı). Kaynak yok; gerekçesi yanında yazılı.
- Inç değerleri mm'ye çevrildi: 1" = 25,4 mm. Tablolarda çap eşlemesi: 1/8" (3,175) → Ø3, 5/32"–3/16" → Ø4, 1/4" (6,35) → Ø6, 5/16" (7,94) → Ø8, 3/8" (9,53) → Ø10, 1/2" (12,7) → Ø12. Ø4 ve Ø8 için doğrudan inç satırı olmayan yerlerde yakın satır alındı ve öyle yazıldı.
- "Chip load" = diş başı ilerleme (fz, mm/diş). Uygulamadaki `spindle.ts` aynı tanımı kullanıyor.
- Kaynak tablolarını kopyalamadık; sayıları atıfla yeniden yazdık.

---

## a) Özet: standart var mı, ne kadar güvenilir?

**Kısa cevap: tek bir "standart" yok, ama yayımlanmış ve atıf yapılabilir başlangıç tabloları var ve birbirine tutarlı bir aralık veriyorlar.** Her takım üreticisi (Freud [S1], Rennie Tool [S2], Amana [S3–S8], Onsrud [S9, S10]) kendi takımları için diş başı ilerleme tablosu yayımlıyor. Malzeme üreticileri (Plexiglas [S14], Acrylite [S15], 3A Composites Dibond/Alucobond [S18–S21], Egger için Leitz/Leuco [S16, S17]) ise daha çok takım geometrisi, yön, soğutma ve özel işlemler (ACM V-kanal katlama) için kural veriyor, sayısal tablo vermiyor ya da az veriyor.

**Güvenilirlik:** Kaynaklar aynı malzeme ve çap için **2–4 kat** farklı değer verebiliyor. Örnek: MDF, Ø6, iki ağızlı spiral için Amana 0,152 mm [S3], ShopBot (Onsrud verisi) 0,15–0,20 mm [S9], Freud 0,33–0,43 mm [S1], Rennie 0,32–0,40 mm [S2] veriyor. Hobi sınıfı makine satıcısı Sorotec aynı durum için 0,07 mm diyor [S11]. Fark üç şeyden geliyor: (1) takım serisi (Amana ve Onsrud'un "genel" serileri düşük, endüstriyel "nesting" serileri yüksek), (2) makine rijitliği, (3) tablonun yazıldığı dikkat düzeyi. Bütün kaynaklar değerlerinin **başlangıç noktası** olduğunu ve deneme kesimiyle doğrulanması gerektiğini açıkça yazıyor [S1, S3, S9, S11, S12].

**Ortak ve güvenilir olan kurallar** (birden çok bağımsız kaynakta aynı):

1. Tablo değerleri **kesme derinliği = 1 × takım çapı** içindir. Derinlik 2 × D ise chip load %25, 3 × D ise %50 azaltılır [S1, S3, S4, S6, S9, S10]. Yazılım bunu otomatik uygulayabilir.
2. Feed = chip load × ağız sayısı × rpm. Çok düşük chip load ısı, takım körelmesi, plastikte erime ve yeniden kaynama demektir [S1, S9, S10 hard plastic notu, S12]. Bu yüzden "güvenli taraf" feed'i sonsuza kadar düşürmek değildir; asıl güvenli adım, chip load'u aralığın altında tutup **derinliği küçültmektir**.
3. Plastik ve alüminyumda tek ağızlı ("O-flute", cilalı kanal) takım normdur [S5, S6, S12, S13, S15, S19]. Ahşap esaslı levhalarda iki ağızlı spiral, melaminde compression (yukarı + aşağı helis) normdur [S4, S16].
4. Rampa iniş feed'i = feed / ağız sayısı (Amana formülü, yani iki ağızlıda %50) [S3–S8].

**Uygulamadaki mevcut değer:** MDF 18 mm, Ø8 iki ağız, 18 000 rpm, 6000 mm/dk → chip load 0,167 mm (T). Bu değer yayımlanmış aralığın **alt ucunda**, yani zaten temkinli. Adım derinliği 6 mm = 0,75 × D; bu da 1 × D kuralının içinde. MDF değeri korunabilir.

**Yöntem:** 2026-11-23'te web araması yapıldı, üretici PDF'leri indirildi ve metinleri okundu (§e). Her malzeme için endüstriyel takım tablolarından en düşük ve en yüksek değer "kaynak aralığı" olarak alındı. Başlangıç değeri (§d) bu aralığın alt ucundan seçildi. Derinlik 0,25–1 × D ile sınırlandı. Feed değeri 100 mm/dk'ya yuvarlandı. Hobi makineleri için yazılmış Sorotec tablosu [S11] aralığa katılmadı; ayrıca "hafif makine alt sınırı" olarak not edildi. Hedef makineler 3–9 kW, 6000–24 000 rpm endüstriyel portal router'lar olduğu için endüstriyel tablolar esas alındı.

**Güven düzeyi (Ö):** MDF, kontrplak, masif ahşap, akrilik ve alüminyum O-flute için **iyi** (birden çok bağımsız üretici tablosu var). Melamin için **orta**: chip load tabloları var, ama asıl sorun (yüzey kırılması) chip load'dan çok takım tipine ve ilk pasın derinliğine bağlı [S16]. PVC köpük (dekota) ve sert PVC için **orta-zayıf**: "soft/hard plastic" satırlarına dayanıyor, malzemeye özel 3A tablosu eski ve sayısı az [S22]. ACM için kontur kesimi **orta**, V-kanal katlama geometrisi **iyi** (3A belgeleri net), V-kanal feed değeri **zayıf**. Pirinç ve bakır için **zayıf** (tek tablo [S11], o da hobi sınıfı). Çelik ve paslanmaz için yayımlanmış router tablosu yok ve bu makinelerde önerilmez (§b.12).

---

## b) Malzeme bölümleri

Her bölüm aynı sekiz başlığı izler: 1 chip load ve rpm, 2 derinlik ve step-over, 3 dalma (plunge), 4 takım geometrisi, 5 kesim yönü ve paso düzeni, 6 soğutma ve toz, 7 tutma (hold-down), 8 yazılımı etkileyen malzeme bilgileri.

### b.1 MDF

1. **Chip load ve rpm.** İki ağızlı spiral (yukarı/aşağı helis), 1 × D derinlik:
   - Freud masif karbür: 1/8" 0,10–0,18 mm; 1/4" 0,33–0,43; 3/8" 0,46–0,53; 1/2" 0,58–0,69 [S1].
   - Rennie Tool (metrik): Ø3,175 0,102–0,178; Ø4 0,140–0,210; Ø6 0,320–0,396; Ø8 0,430–0,500; Ø10 0,520–0,590; Ø12 0,613–0,660 [S2]. 18 000 rpm önerir [S2].
   - Amana 2 ağız spiral, "MDF/Laminate", 18 000 rpm: 1/8" 0,127; 1/4" 0,152; 5/16" 0,229; 3/8" 0,274; 1/2" 0,244 [S3].
   - ShopBot (Onsrud 52-910/57-910 verisi), 1/4" 2 ağız, 18 000 rpm: 0,15–0,20 [S9]. Tek ağızlı 1/4" (65-025): 0,10–0,15 [S9].
   - Hafif makine alt sınırı: Sorotec vc 450 m/dk, Ø6 0,070, Ø8 0,080 [S11].
   - Örnek türetme (T): Ø8, 2 ağız, 18 000 rpm, fz 0,167 → 6000 mm/dk (uygulamadaki değer).
2. **Derinlik.** Tablolar 1 × D içindir; 2 × D'de chip load %25, 3 × D'de %50 düşürülür [S1, S9, S10]. Endüstriyel nesting'de 18 mm levha tek pasta, destek levhasına 0,3–0,5 mm girerek kesilir [S16]. Başlangıç için çok paso (≤ 1 × D) önerilir (Ö). Cep boşaltmada step-over için yayımlanmış sayı bulunamadı; Sorotec kontur kesimde yanal adımı yaklaşık %25 D, tam derinlikte öneriyor [S11]. Klasik cep için %40–50 D (Ö).
3. **Dalma.** Rampa feed'i = feed / ağız sayısı, yani 2 ağızlıda %50 [S3]. Tam feed'de düz dalış takımın kendi ekseni etrafında itilmesine ve sapmaya yol açar [S27]. Cep ve açıklık işlerken dalma ucu (plunge tip) olan takım kullanılmalı [S17]. MDF'de düz dalış, merkezden kesen takım ve düşük feed ile kabul edilebilir (Ö); uygulamanın mevcut 1500/6000 = %25 değeri temkinli tarafta.
4. **Takım.** Masif karbür iki ağız spiral. Aşağı helis üst yüzeyi temiz tutar, talaşı kanalda bırakır. Yukarı helis talaşı iyi atar, üst kenarda tüylenme yapabilir. Compression her iki yüzeyi temiz bırakır ama bu tablolar compression için geçerli değildir [S1, S2]; compression için ayrı tablo: Amana 2 ağız, MDF/Laminate 1/4" 0,155, 3/8" 0,282, 1/2" 0,282 [S4].
5. **Yön ve paso.** Sorotec: boşluksuz vidalı makinede tırmanma (climb, Almanca "Gleichlauf") tercih edilir; boşluklu makinede karşı yön (conventional) [S11]. Yayımlanmış MDF'ye özel tırmanma/karşı yön kuralı bulunamadı. Son pasoda ince bitiş pasosu ve küçük parçada köprü (tab) uygulaması yaygındır; köprü boyutu için kaynak bulunamadı, uygulamanın `TAB_DEFAULTS` (4 köprü, 10 mm, en çok 3 mm malzeme) değeri makul (Ö).
6. **Soğutma ve toz.** Soğutma yok; talaş emişi şart. HSE: sert ağaç tozu sınırı 3 mg/m³, yumuşak ağaç tozu 5 mg/m³ (8 saatlik ortalama), karışımda 3 mg/m³ geçerli; sert ağaç tozu burun kanserine yol açabilir; yerel emiş (LEV) kurulmalı ve en az 14 ayda bir yetkin kişiye kontrol ettirilmeli; basınçlı havayla temizlik yapılmamalı [S25]. MDF formaldehit sınıfları: E0 ≤ 0,062 mg/m³, E1 ≤ 0,124 mg/m³ (TS EN 12460-1) [S24].
7. **Tutma.** Vakum masa ve MDF destek (spoilboard) levhası standarttır; destek levhasına 0,3–0,5 mm girilir, kauçuk mat kullanılırsa 0,05–0,1 mm [S16]. Küçük parçalar kesildikten sonra vakumu kaybeder; uygulamanın küçük parça kuralı (alan < 0,05 m² ya da kısa kenar sınırı) bunu karşılıyor.
8. **Malzeme bilgileri.** Damar yok. Kastamonu Medepan: genişlik 1220–2800, boy 1830–4200, kalınlık 3–40 mm [S24 katalog]; zımparalı kalınlık toleransı ±0,2 mm (ince bantlar) ve ±0,3 mm (kalın bantlar), en/boy ±5 mm, gönyeden sapma ±2 mm/m (TS EN 622-1) [S24 teknik föy]. Piyasada en yaygın ebatlar 2100 × 2800 ve 1830 × 3660 mm (Ö, katalog aralığının içinde; tedarikçiyle doğrulanmalı). Kalınlık toleransı yüzünden Z sıfırı levha üstünden alınıyorsa tam kesim derinliği "kalınlık + destek payı" olmalı; uygulamada `spoilboardAllowance` bunu karşılıyor.

### b.2 Kontrplak

1. **Chip load ve rpm.** Freud "plywood" (masif karbür): 1/8" 0,08–0,13; 1/4" 0,15–0,23; 3/8" 0,38–0,46; 1/2" 0,46–0,53 [S1]. Rennie "soft plywood": Ø3,175 0,102–0,153; Ø4 0,120–0,180; Ø6 0,270–0,320; Ø8 0,360–0,420; Ø10 0,445–0,520; Ø12 0,500–0,560 [S2]. Amana 2 ağız spiral "Wood/Plywood" 18 000 rpm: 1/8" 0,102; 1/4" 0,127; 5/16" 0,137; 3/8" 0,163; 1/2" 0,145 [S3]. Amana compression 2 ağız "Plywood": 1/4" 0,079; 3/8" 0,142; 1/2" 0,196 [S4]. Onsrud'un sert kontrplak tablosunda seriye göre 1/4" için 0,10 ile 0,61 mm arası değerler var [S10]; seri-çap hizası PDF metninden güvenle okunamadığı için sayı olarak kullanılmadı.
2. **Derinlik.** 1 × D kuralı [S1, S3]. 2 × D için %25 azaltma [S1].
3. **Dalma.** MDF ile aynı: rampa %50 [S3], düz dalışta düşük feed (Ö).
4. **Takım.** Kaplama yüzü olan kontrplakta iki yüzün de temiz kalması için compression ya da aşağı helis tercih edilir (Ö; Leitz nesting compression mantığı [S16]). Compression ile kontrplakta Amana'nın chip load'u MDF'nin yarısı kadar [S4]; yani aynı takım kontrplakta daha yavaş sürülmeli.
5. **Yön ve paso.** Kaynakta kontrplağa özel kural yok. Alt yüzde kaplama kopmasını önlemek için son pasoda ince "onion skin" bırakıp ayrı bitirme (Leuco'nun iki aşamalı kesim mantığı [S12]) uygulanabilir (Ö).
6. **Soğutma ve toz.** Yok; emiş. Ahşap tozu sınırları MDF ile aynı [S25].
7. **Tutma.** Vakum + destek levhası [S16]. Kontrplak çarpık gelebilir; geniş levhada vakum yetmezse kenar kelepçesi ya da vida (Ö).
8. **Malzeme bilgileri.** **Damar var** (üst kaplamanın yönü), uygulamadaki damar yönü kuralı geçerli. Katmanlarda boşluk ve tutkal çizgisi olabilir; kalınlık toleransı MDF'den geniştir (Ö, sayısal kaynak bulunamadı). Türkiye'de 125 × 250 cm huş kontrplak satışta [S26]; kayın kontrplak 4, 6, 8, 12, 15 mm kalınlıklarda listeleniyor [S26]. 122 × 244 ve 170 × 220 ebatları için kaynak bulunamadı (açık madde).

### b.3 Melamin kaplı yonga levha ve MDF (melamin, suntalam)

1. **Chip load ve rpm.** Freud "laminated particle board" (masif karbür): 1/8" 0,08–0,15; 1/4" 0,25–0,38; 3/8" 0,36–0,46; 1/2" 0,56–0,66 [S1]. Rennie MDF/yonga satırı (b.1) aynı [S2]. Amana compression 2 ağız "MDF/Laminate": 1/8" 0,056; 5/32" 0,079; 3/16" 0,112; 1/4" 0,155; 3/8" 0,282; 1/2" 0,282 [S4]. Leitz (Egger Eurodekor için): CNC'de 18 000–24 000 rpm [S16]. Leuco (Egger PerfectSense, mat/parlak lake yüzeyli levha): Ø3–10 için fz 0,03–0,10; Ø10–16 için 0,10–0,20 mm [S17]; bu düşük değerler özel yüzeyli levha içindir.
2. **Derinlik.** Compression takımda üst yüzeyi aşağı helis bölümü korur; bu yüzden **ilk paso en az aşağı helis boyu kadar derin olmalı**. Leitz "nesting" compression (HW Z2+2) takımlarında yırtılmasız kesim için en küçük kanal derinliği `ap min` 5–8 mm (takım boyuna göre) [S16]. Endüstride 18 mm tek pasta kesilir [S16]. Temkinli başlangıç: iki paso, her biri ~9 mm (Ö). Uygulamanın mevcut "6 mm × 3 paso" değeri, compression takımla ilk pasoyu `ap min` altına düşürebilir ve **üst yüzeyi kırabilir**.
3. **Dalma.** Rampa %50 [S4 rampa sütunu]. Compression takımların çoğu dalmaya uygun değildir; cep ve açıklıkta dalma ucu olan takım gerekir [S17].
4. **Takım.** Compression (Z1+1 ya da Z2+2) ya da elmas uçlu (DP) router [S16]. Yanlış takımın etkisi: yukarı helis üst melamin yüzünü kırar, aşağı helis alt yüzü kırar (Ö; compression'ın varlık sebebi bu [S16]). Kesim kalitesi için takım iyi bileylenmiş olmalı ve shrink/hidro pens tercih edilmeli [S16, S17].
5. **Yön ve paso.** Leitz, kenar frezeleme (jointing) için "ilerlemeyle aynı yön (GLL)" çalışmada fz 0,06–0,2 mm diyor [S16]; nesting için yön kuralı vermiyor. Köprü (tab) yerine çoğu nesting makinesi vakumla tam keser [S16].
6. **Soğutma ve toz.** Yok; emiş. Yonga levha tozu ahşap tozu sınırına tabidir [S25].
7. **Tutma.** Vakum + MDF destek levhası (0,3–0,5 mm giriş) ya da kauçuk mat (0,05–0,1 mm giriş) [S16].
8. **Malzeme bilgileri.** **Yüzü ve dekoru var**; ahşap desenli dekorlarda damar yönü önemlidir (uygulamadaki damar kuralı). Kastamonu düşük yoğunluklu melamin kaplı levha: genişlik 1830–2100, boy 2800–3660, kalınlık 6–40 mm [S24 katalog]. Yonga levhanın kesim kenarı gözeneklidir; kenar bandı ayrı işlemdir.

### b.4 Masif ahşap (yumuşak ve sert ayrı)

1. **Chip load ve rpm.**
   - **Yumuşak ağaç:** Freud 1/8" 0,10–0,15; 1/4" 0,25–0,30; 3/8" 0,41–0,48; 1/2" 0,51–0,58 [S1]. ShopBot (Onsrud 52-910) 1/4" 2 ağız 0,18–0,23 [S9]. Sorotec vc 500, Ø6 0,060, Ø8 0,070 [S11].
   - **Sert ağaç:** Freud 1/8" 0,05–0,13; 1/4" 0,20–0,28; 3/8" 0,36–0,41; 1/2" 0,46–0,53 [S1]. Rennie Ø3,175 0,076–0,127; Ø4 0,102–0,153; Ø6 0,220–0,270; Ø8 0,310–0,370; Ø10 0,400–0,477; Ø12 0,460–0,513 [S2]. ShopBot 1/4" yukarı helis 0,15–0,20, aşağı helis 0,13–0,18 [S9]. Amana "Wood" 1/4" 0,127 [S3]. Sorotec vc 450, Ø6 0,055, Ø8 0,065 [S11].
2. **Derinlik.** 1 × D kuralı [S1, S9]. Sert ağaçta kesme kuvveti yüksek olduğu için başlangıçta 0,5 × D önerilir (Ö).
3. **Dalma.** Rampa %50 [S3]; düz dalış düşük feed ile (Ö).
4. **Takım.** Masif karbür spiral, 2 ağız. Yanlış seçimde lif yırtılması (tear-out) ve yanık izi olur; çok düşük chip load sürtünme ve ısı üretir [S1, S9].
5. **Yön ve paso.** Lif yönüne karşı kesimde yırtılma riski; bitiş pasosu ile düzeltilir (Ö). Kaynaklarda masif ağaca özel yön kuralı bulunamadı.
6. **Soğutma ve toz.** Yok; emiş. Sert ağaç tozu 3 mg/m³, yumuşak ağaç tozu 5 mg/m³ sınır; sert ağaç tozu kanserojen [S25].
7. **Tutma.** Masif ağaç panel çarpık olabilir; vakum yetmeyebilir, vida ya da kelepçe gerekebilir (Ö).
8. **Malzeme bilgileri.** **Damar var** ve mukavemet yönü vardır. Nem ile boyut değişir; kalınlık toleransı geniştir (Ö, sayısal kaynak yok). Uygulamada yumuşak ve sert ayrı malzeme türü (iki `MaterialKind` ya da `solidWood` altında alt tür) olmalı, çünkü sert ağaç değerleri yaklaşık %20–30 daha düşük [S1].

### b.5 Akrilik (PMMA): döküm (GS) ve ekstrüzyon (XT)

1. **Chip load ve rpm.**
   - Amana tek ağız "plastic O-flute", 18 000 rpm: Ø3 0,10–0,15; Ø4 0,15–0,20; Ø6 0,20–0,30; Ø8 0,23–0,33; Ø10 0,28–0,41; Ø12 0,38–0,51 mm; yüzey hızı 500–1200 SFM (152–366 m/dk) [S5].
   - Freud "acrylics/hard plastic" (masif karbür, 1–3 ağız): 1/8" 0,05–0,10; 1/4" 0,13–0,20; 3/8" 0,20–0,25; 1/2" 0,25–0,30 [S1]. Rennie "acrylic": Ø6 0,194–0,245; Ø8 0,229–0,279; Ø10 0,266–0,314; Ø12 0,295–0,370 [S2].
   - Acrylite (Polyvantis): en iyi chip load 0,10–0,38 mm/diş; 1/4"–1/2" takımda 16 000–18 000 rpm, 1/8"–3/16" takımda 18 000–20 000 rpm; tipik feed 2,5–7,6 m/dk (100–300 IPM) [S15].
   - Plexiglas (Polyvantis): kesme hızı 200–4500 m/dk, ilerleme ≤ 0,5 mm/devir, kesme derinliği ≤ 6 mm, serbest açı 2–10°, talaş açısı 0–5° [S14].
   - Leitz: tek ağızlı spiral bitirme frezesi Ø3–10, 14 000–22 000 rpm, 3–4 m/dk [S13] → 18 000 rpm'de fz 0,17–0,22 mm (T).
   - Leuco: tek ağızlı plastik frezesi kaba kesim 2–6 m/dk, 18 000 rpm [S12] → fz 0,11–0,33 mm (T); bitirme Ø3–8 için 0,5–1,5 m/dk, yanal talaş 0,1–0,4 mm, 18 000–24 000 rpm [S12].
2. **Derinlik.** Acrylite: başlangıçta 2,5 mm/paso, en çok 0,5–0,67 × D; bitirme pasosu en az 0,25 mm [S15]. Leuco: bir ilerlemede en çok 2 × D; çok paso ısınmayı önler [S12]. Plexiglas: ≤ 6 mm [S14]. Leuco iki aşamalı kesim: kaba paso levha kalınlığından 0,1–0,2 mm sığ, bitirme pasosu 0,1–0,2 mm derin [S12] (onion-skin mantığı).
3. **Dalma.** Rampa feed'i = feed / ağız sayısı, tek ağızda feed'in kendisi [S5]. Yerinde bekleyen yavaş dalış ısınma ve erime yapar; rampa ya da heliks tercih edilir (Ö, [S10] "rewelding" notu ile uyumlu).
4. **Takım.** Masif karbür, yukarı helis, tek ağız "O-flute", cilalı kanal [S12, S13, S15]. Çok ağızlı takım yüksek devirde tıkanır [S14]. Yanlış takım ya da düşük chip load: erime, talaşın kesime geri kaynaması; Onsrud: "talaş geri kaynıyorsa feed'i artırın ya da tek ağızlı takıma geçin" [S10]. Tek ağızlı takımda pens dengesi önemlidir, yoksa titreşim izi kalır [S14].
5. **Yön ve paso.** Acrylite çoğu iş için **karşı yön (conventional)** öneriyor: dış konturu saat yönünün tersine, iç konturu saat yönünde; tırmanma yalnızca boşluksuz, rijit makinede [S15]. Leuco: yüksek feed'de karşı yön (GGL) önerilir; düşük talaşta titreşim izi oluşur [S12].
6. **Soğutma ve toz.** Plexiglas: router işlemede soğutma normalde gerekmez [S14]. Leuco: ısınmayı ve gerilme beyazlamasını önlemek için talaşı **basınçlı hava** ile uzaklaştırın [S12]. Acrylite: hava, sis ya da soğuk hava erimiş kenarda yardımcı olur [S15]. Sorotec: sabunlu suyla iyi yüzey [S11].
7. **Tutma.** Acrylite: yüksek vakum/düşük debi pompa + kanallı conta en güçlü tutuş; geniş debili "universal" vakum masası küçük parçalar için önerilmez; cıvata ya da kelepçe de olur [S15]. Leuco: emiş kaplarını temizleyin, parça taşmasını küçük tutun [S12].
8. **Malzeme bilgileri.** Damar yok. **Koruyucu folyo** var; folyo kesim sırasında üstte kalabilir [S14]. Isıl genleşme 0,07 mm/(m·K): 20 K farkta 1 m parçada 1,4 mm [S14]. İşleme iç gerilme yaratır; tavlama (annealing) ile giderilir [S14]. **XT (ekstrüzyon) GS'den (döküm) ısıya daha duyarlıdır**: düşük feed ve yüksek devirden kaçının [S12]. Yazılım için: XT ve GS aynı tabloyla ama XT'de paso derinliği daha küçük ve hava üflemesi zorunlu olmalı (Ö). Türkiye'deki levha ebatları için güvenilir kaynak bulunamadı (açık madde).

### b.6 PVC: köpük levha (dekota, foreks) ve sert PVC

1. **Chip load ve rpm.**
   - Köpük PVC "soft plastic" satırına girer: Freud 1/8" 0,08–0,13; 1/4" 0,15–0,23; 3/8" 0,25–0,30; 1/2" 0,30–0,38 [S1]. Rennie "soft plastic" Ø6 0,168–0,242; Ø8 0,221–0,278 [S2]. Amana plastic O-flute (b.5) [S5].
   - Sert PVC "hard plastic" satırına girer: Freud 1/4" 0,13–0,20 [S1]. Rennie "hard plastic" Ø6 0,148–0,221; Ø8 0,181–0,240 [S2].
   - 3A Composites köpük PVC (Sintra/e-pvc): router için karbür takım, kesme hızı yaklaşık 3000 FPM (≈ 914 m/dk) [S22]. Aynı tablodaki feed değeri ("10 inç/dk") el router'ı içindir ve CNC için kullanılamaz (Ö).
2. **Derinlik.** Köpük yumuşaktır; 1 × D (Ö, [S1] kuralı). Sert PVC'de 0,5 × D (Ö).
3. **Dalma.** Rampa; plastikte yerinde bekleme ısıtır (Ö).
4. **Takım.** Tek ağız O-flute ya da iki ağız yukarı helis [S5]. Testere için 3A "triple chip / plastik kesim" diş öneriyor [S22]. 3A Forex: 8 mm ve üstünde bükmeden önce V-kanal açılır [S22 ile aynı aile, Forex için arama özeti; föy okunamadı, açık madde].
5. **Yön ve paso.** Kaynakta PVC'ye özel kural yok; akrilik kuralı (karşı yön) uygulanabilir (Ö).
6. **Soğutma ve toz.** 3A: toz için yerel emiş ve gerekirse solunum koruması [S22]. PVC aşırı ısınırsa bozunur ve tahriş edici gaz çıkarır (genel bilgi, kaynak eklenmedi); bu yüzden düşük chip load'dan kaçınılmalı.
7. **Tutma.** Köpük levha hafiftir; vakum iyi tutar, ama küçük parçalar kolay kayar (Ö). Sıkarken yüzey ezilmesin diye ara parça [S22].
8. **Malzeme bilgileri.** Damar yok. Köpük PVC'nin kesim kenarında açık hücreler görünür; kenar zımpara ya da bitiş pasosu ister [S22]. Isıl genleşme yüksektir (Ö). Türkiye ebatları için kaynak bulunamadı (açık madde).

### b.7 Alüminyum levha (5xxx, 6xxx, 1–6 mm) (aday)

1. **Chip load ve rpm.**
   - Amana tek ağız alüminyum O-flute, 18 000 rpm, 1 × D: Ø3–Ø4 (1/8", 3 mm, 4 mm) 0,05–0,10; Ø5–Ø6 (3/16"–1/4", 6 mm) 0,076–0,15; Ø8–Ø10 0,10–0,20; Ø12 0,15–0,25 mm; yüzey hızı 600–1000 SFM (183–305 m/dk) [S6]. ZrN kaplı sürümde aynı değerler [S6].
   - Amana ZrN iki ağız alüminyum parmak freze, 1/4", 18 000 rpm, kanal (slot) 1 × D: 0,051 mm [S7].
   - Freud "solid surface/aluminum" (masif karbür): 1/8" 0,076–0,10; 1/4" 0,13–0,18; 3/8" 0,15–0,20; 1/2" 0,20–0,25 [S1]. Rennie alüminyum: Ø3,175 0,076–0,127; Ø4 0,081–0,133; Ø6 0,102–0,155; Ø8 0,139–0,187; Ø10 0,160–0,210; Ø12 0,193–0,245 [S2].
   - Sorotec dövme alaşım: vc 500 m/dk; Ø3 0,025; Ø4 0,050; Ø6 0,050; Ø8 0,064; Ø10 0,080; Ø12 0,100 [S11]; örnek: Ø8, 2 ağız, 19 904 rpm → 2548 mm/dk [S11].
   - **Kaynaklar devirde ayrışıyor:** Amana tabloyu 18 000 rpm'de veriyor ama aynı tabloda 183–305 m/dk yazıyor; Ø6'da 18 000 rpm 339 m/dk eder (T). 183–305 m/dk Ø6 için 9700–16 200 rpm demek (T). Sorotec'in 500 m/dk değeri Ø6'da 26 500 rpm ister (T), bu da çoğu iş milinin üstünde. Sonuç (Ö): Ø6–Ø8'de 16 000–18 000 rpm, Ø10–Ø12'de 12 000–15 000 rpm.
2. **Derinlik.** Sorotec: demir dışı metalde kanal derinliği en çok 0,5 × D [S11]. Amana O-flute tablosu 1 × D [S6] (rijit makine varsayımı). Datron: sığ paso sapma, titreşim ve ısıyı azaltır [S29]. Başlangıç (Ö): 0,25 × D. 3 mm levha Ø6 ile 2 paso.
3. **Dalma.** Rampa iniş feed'i = feed / ağız sayısı [S6, S7]. Kaynakta rampa açısı için üretici sayısı bulunamadı; CNCCookbook örneğinde 1/2" karbür frezede 6061 için 6,1° var (ikincil kaynak, açık madde). Uygulamanın varsayılan 3° zig-zag rampası (`TOOLPATH_DEFAULTS.rampAngleDeg`) temkinli ve uygun (Ö). Delik için heliks (Ö).
4. **Takım.** Masif karbür tek ağız O-flute, cilalı kanal, isteğe bağlı ZrN kaplama [S6, S19]. Çok ağızlı takımda talaş sıkışır ve takım kırılır (CNCCookbook, ikincil kaynak; arama özeti). Hatalar: yığma kenar (built-up edge, takıma yapışma), çapak, talaşın kanala yeniden girmesi; hepsi düşük chip load ve yetersiz talaş atımıyla artar [S29, Ö].
5. **Yön ve paso.** Sorotec: boşluksuz makinede tırmanma tercih [S11]. Alucobond (ACM, aynı takım) sağ helisli tek ağız ile parça dış konturunu saat yönünün tersine, delik/iç konturu saat yönünde işlemeyi çiziyor [S19]; bu, M3 iş milinde karşı yön (conventional) demektir (T). Bitiş pasosu ve **çapak alma (chamfer/deburr)** pasosu gerekir (Ö).
6. **Soğutma.** Sorotec: demir dışı metalde en iyisi minimum yağlama (MQL) [S11]. Datron: taşma soğutma yerine **etanol** [S29]. Amana: sis yağlama ya da hava soğutma (ürün sayfası, arama özeti). Yazılım için: soğutma açma/kapama kodu post'ta ayrı bir alan olmalı (§c sonrası bulgular).
7. **Tutma.** Alucobond: vakum masa + MDF destek levhası önerilir [S19]. İnce levha vakumla tutulur; parçalar kesilince vakum kaybolur; köprü, çift taraflı bant ya da vida gerekebilir (Ö). Alüminyum talaşı vakum masasında yüzeyi çizer ve destek levhasına gömülür (Ö).
8. **Malzeme bilgileri.** Damar yok, ama **fırçalanmış yüzeyde yön** vardır. Koruyucu folyo olabilir (Ö). Levha ebatları için Türkiye kaynağı bulunamadı; tipik 1000 × 2000, 1250 × 2500, 1500 × 3000 mm (Ö, doğrulanmalı).

### b.8 Alüminyum kompozit panel (ACM, kompozit panel, 3–4 mm) (aday)

1. **Chip load ve rpm (kontur kesimi).** Alucobond: alüminyum ve plastik için uygun karbür takımlar ACM için de uygundur; temiz kesim örneği **5 m/dk, 24 000 rpm**, tek ağızlı, sağ helisli, cilalı kanallı masif karbür freze [S19] → fz ≈ 0,21 mm (T). Dibond: karbür, keskin takım, tek ya da çok ağız olabilir; kesimde yağlayıcı ya da soğutucu gerekmez [S18].
2. **Derinlik.** Toplam kalınlık 3–4 mm olduğu için Ø6 ve üstü takımla tek paso (Ö). Alucobond V-kanal ve kanal derinliği için aşağıya bakın.
3. **Dalma.** Alüminyum gibi rampa (Ö).
4. **Takım ve V-kanal katlama ("rout and return").**
   - Katlama hattına arka yüzden kanal açılır; dış alüminyum yüz ve çekirdeğin bir kısmı kalır, panel elle katlanır [S19]. 90° V-kanal 90°'ye kadar, 135° V-kanal 135°'ye kadar (iki 45° katlama), dikdörtgen kanal panel kalınlığına göre 180°'ye kadar katlar; V-kanalda iç yarıçap yaklaşık 2–3 mm, dikdörtgen kanalda 7 mm [S19]. Yöntem Alucobond A2 (yanmaz çekirdek) için uygun değil [S19].
   - Dibond: en yaygın kanal, **tabanı en az 1/8" (3,2 mm) düzleştirilmiş** "modifiye 90° V"; doğru derinlikte dış yüz sağlam ve kanal tabanında yaklaşık 1/64" (0,4 mm) polietilen kalır; sığ kanal katlamada geri yaylanır, derin kanal dış yüzü çizer ve zayıflatır [S18].
   - Kalan kalınlık: Alucobond kenar bükme kılavuzu 0,8 mm kalan kalınlık, 0,5 mm aralık ve > 1,5 mm yarıçap veriyor [S20]; Alucolux kılavuzu 90°, 120° ve 135° kanalların hepsi için 0,8 mm kalan kalınlık gösteriyor [S21]. 4 mm ASAŞ Alfabond'da dış alüminyum 0,30 mm [S28]; Dibond'un "0,4 mm PE" kuralı 0,30 + 0,4 ≈ 0,7 mm kalan eder (T). Yani hedef **kalan kalınlık ≈ 0,7–0,8 mm**.
   - V-kanal feed'i: Amana ACM çift ağızlı V-kanal tablosu, 18 000 rpm, alüminyum satırı: 3–5 mm derinlikte 0,9–1,8 m/dk (fz 0,025–0,05 mm), PVC satırı 1,8–3,6 m/dk [S8]. Alucolux CNC örneğinde en çok 8 m/dk, 25 000 rpm [S21]. Amana tablosu temkinli uçtadır; ACM'nin çoğu PE çekirdek olduğu için gerçek feed aralığı açık maddedir.
   - Takım: çift ağızlı, düz tabanlı V-kanal takımı (90°, 108°, 135°, 155° açılı modeller) [S8]; maksimum devir V-kanal takımında 28 000–35 000 rpm, takma bıçaklı modellerde 18 000–22 000 rpm (Amana ürün sayfaları, arama özeti).
5. **Yön ve paso.** Kontur için Alucobond'un yön çizimi (karşı yön) [S19]. V-kanal tek paso, sabit derinlik şart: "derinlik sabit olursa katlama çizgisi düzgün olur" [S18].
6. **Soğutma ve toz.** Dibond: soğutucu gerekmez [S18]. Alucolux CNC örneğinde emülsiyon ısı ve gürültüyü azaltıyor [S21] (opsiyonel). Talaş PE + alüminyum karışık; emiş (Ö).
7. **Tutma.** Vakum masa + MDF destek levhası; yüzeyde baskı izi olmaması için plastik ya da ahşap çene [S19].
8. **Malzeme bilgileri.** **Yüz tarafı var** (boyalı dış yüz) ve V-kanal **arka yüzden** açılır: panel yüzü aşağı yatırılır, yani çizim aynalanır. Koruyucu folyo var. Fırçalanmış yüzeylerde yön var. Katlama sıcaklığı 0 °C'nin altında olmamalı [S19]. Kanalsız en küçük bükme yarıçapı 30 × kalınlık [S18]. Kalınlık toleransı ±0,2 mm (Dibond [S18], Alfabond [S28]). ASAŞ Alfabond: kalınlık 3–6 mm, genişlik 1250 ve 1500 mm, standart 1250 × 3200 ve 1500 × 3200, en çok 6000 mm boy; genişlik toleransı −0/+2 mm, boy −0/+4 mm [S28]. Dibond: 2, 3, 4 mm; 4' × 8', 4' × 10', 5' × 10' [S18]. Isıl genleşme: 8 ft (2,44 m) panelde 100 °F (≈ 56 K) farkta yaklaşık 1/8" (3,2 mm) [S18].

### b.9 Pirinç ve bakır levha (gravür ve kesim) (aday)

1. **Chip load ve rpm.** Sorotec "pirinç, bakır, bronz": vc 365 m/dk; Ø3 0,025; Ø4 0,025; Ø6 0,050; Ø8 0,056; Ø10 0,065; Ø12 0,080 mm [S11]. Bu tek sayısal tablodur ve hobi makineleri içindir. Amana ACM V-kanal tablosunda pirinç satırı: < 3 mm derinlikte 0,25–0,76 m/dk, 3–5 mm'de 0,76–1,52 m/dk, 18 000 rpm, 2 ağız [S8]. vc 365 m/dk Ø6'da 19 400 rpm, Ø12'de 9700 rpm eder (T).
2. **Derinlik.** Demir dışı metal: kanalda en çok 0,5 × D [S11]. Gravürde çok sığ paso: Amana'nın bir kullanıcıya önerisi 0,05 mm (0,002") paso ve 0,5 m/dk (forum aktarımı, ikincil, açık madde).
3. **Dalma.** Rampa (Ö).
4. **Takım.** Karbür; gravürde V uçlu ya da tek ağızlı gravür ucu (Ö). Bakır yapışkandır, yığma kenar yapar (Ö).
5. **Yön ve paso.** Çapak alma pasosu gerekir (Ö).
6. **Soğutma.** MQL ya da yağlayıcı [S11].
7. **Tutma.** İnce levha vakumla zor tutulur; çift taraflı bant ya da vida (Ö).
8. **Malzeme bilgileri.** Yüzey parlatılmış olabilir, folyo olabilir (Ö). Güvenilir veri az: ürün olarak "gravür" önce, "kesim" sonra eklenmeli (Ö).

### b.10 HPL ve kompakt laminat (kısa)

Rennie "high pressure laminate": Ø6 0,219–0,294; Ø8 0,311–0,381; Ø12 0,546–0,595 mm [S2]. Leitz kompakt laminat için elmas uçlu (DP) takım öneriyor; sizing router örneğinde bitirme 2–3 m/dk, ön kesim 10–15 m/dk [S23]. Karbür takım çok çabuk aşınır (Ö). Önerilmez kategorisinde değil ama DP takım ve ayrı bir tablo ister.

### b.11 Polikarbonat ve HDPE (kısa)

Malzemeye özel üretici tablosu bulunamadı. HDPE "soft plastic", polikarbonat "hard plastic" satırına girer: Freud 1/4" soft 0,15–0,23, hard 0,13–0,20 [S1]; Rennie Ø6 soft 0,168–0,242, hard 0,148–0,221 [S2]. Tek ağız O-flute [S5]. Ayrı malzeme olarak eklemek için malzeme üreticisi kılavuzu bulunmalı (açık madde).

### b.12 Yumuşak çelik ve paslanmaz: bu router'larda gerçekçi mi?

**Hayır, ürün olarak önerilmemeli.** Gerekçe:

- Sorotec'in tablosu çelik için vc 90 m/dk veriyor [S11]. Bu, Ø6 takımda 4775 rpm, Ø8'de 3580 rpm eder (T). Hedef iş millerinin alt sınırı 6000 rpm (uygulamanın örnek profili [kod]); yani doğru kesme hızı iş milinin **altında** kalıyor. 6000 rpm'de Ø6 için vc 113 m/dk olur (T), bu da karbür takımı çeliğe göre fazla hızlı sürer.
- Hava soğutmalı ER pensli router iş millerinde tork düşük devirde düşer (sabit güç bandı yüksek devirdedir) (Ö, genel bilgi); çelik ise düşük devirde yüksek tork ister.
- Takım üreticileri alüminyum O-flute takımlarla demirli metal kesilmemesini açıkça yazıyor (Amana ürün açıklaması, arama özeti; sayfa 429 verdi, açık madde).
- Portal router gövdesi freze tezgâhından hafiftir, kesme kuvvetinde esner (ikincil kaynaklar, arama özeti).

Paslanmaz daha da kötüdür (sertleşme, ısı). Ürün davranışı (Ö): çelik ve paslanmaz malzeme listesinde yer almaz; kullanıcı elle girerse uyarı gösterilir.

---

## c) Birleşik tablo (geliştirici için)

**Sütunlar.** `cl_min` ve `cl_max`: o çap için endüstriyel kaynak tablolarındaki en düşük ve en yüksek chip load (mm/diş), kaynak etiketi notta. `cl_start`: §d'deki temkinli başlangıç (Ö). rpm: kaynak aralığı ve başlangıç. `stepDown`: başlangıç paso derinliği (× D, Ö; kural [S1]). `plunge`: `plungeFeed / feed` başlangıç oranı (Ö; rampa formülü [S3]). `entry`: `straight-ok` (merkezden kesen takımla düz dalış olur), `ramp-pref` (rampa tercih), `ramp-req` (rampa ya da heliks zorunlu). `tool`: `spiral` (yukarı/aşağı helis düz freze, `flatEndMill`), `comp` (`compression`), `oflute` (tek ağız, `flatEndMill` + `flutes: 1`), `vgroove` (düz tabanlı V, `vBit`). `cool`: `none`, `air`, `mql`.

Feed (T) = `cl_start × flutes × rpm_start`, 100'e yuvarlandı. Ø4 ve Ø8 değerleri inç tablolarda yakın satırdan alındı.

| material | Ø | z | cl_min | cl_start | cl_max | rpm min | rpm start | rpm max | feed start (T) | stepDown | plunge | entry | tool | cool | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mdf | 3 | 2 | 0,10 | 0,10 | 0,18 | 18000 | 18000 | 24000 | 3600 | 1,0 | 0,25 | straight-ok | spiral | none | S1, S2, S3 |
| mdf | 4 | 2 | 0,10 | 0,10 | 0,21 | 18000 | 18000 | 24000 | 3600 | 1,0 | 0,25 | straight-ok | spiral | none | S2, S3 (5/32") |
| mdf | 6 | 2 | 0,15 | 0,15 | 0,43 | 18000 | 18000 | 24000 | 5400 | 1,0 | 0,25 | straight-ok | spiral | none | S1, S2, S3, S9; Sorotec 0,07 |
| mdf | 8 | 2 | 0,23 | 0,167 | 0,50 | 18000 | 18000 | 24000 | 6000 | 0,75 | 0,25 | straight-ok | spiral | none | uygulamadaki mevcut değer; S2, S3 (5/32"–3/8") |
| mdf | 10 | 2 | 0,27 | 0,22 | 0,59 | 18000 | 18000 | 24000 | 7900 | 0,75 | 0,25 | straight-ok | spiral | none | S1, S2, S3 |
| mdf | 12 | 2 | 0,24 | 0,24 | 0,69 | 18000 | 18000 | 24000 | 8600 | 0,5 | 0,25 | straight-ok | spiral | none | S1, S2, S3 |
| plywood | 3 | 2 | 0,08 | 0,08 | 0,15 | 18000 | 18000 | 24000 | 2900 | 1,0 | 0,25 | straight-ok | spiral | none | S1, S2, S3 |
| plywood | 4 | 2 | 0,10 | 0,08 | 0,18 | 18000 | 18000 | 24000 | 2900 | 1,0 | 0,25 | straight-ok | spiral | none | S2 |
| plywood | 6 | 2 | 0,13 | 0,13 | 0,33 | 18000 | 18000 | 24000 | 4700 | 1,0 | 0,25 | straight-ok | spiral | none | S1, S2, S3; compression: S4 0,079 |
| plywood | 8 | 2 | 0,14 | 0,14 | 0,42 | 18000 | 18000 | 24000 | 5000 | 0,75 | 0,25 | straight-ok | spiral | none | S2, S3 |
| plywood | 10 | 2 | 0,16 | 0,16 | 0,52 | 18000 | 18000 | 24000 | 5800 | 0,75 | 0,25 | straight-ok | spiral | none | S1, S2, S3; compression S4 0,142 |
| plywood | 12 | 2 | 0,145 | 0,16 | 0,56 | 18000 | 18000 | 24000 | 5800 | 0,5 | 0,25 | straight-ok | spiral | none | S1, S2, S3 |
| melamine | 6 | 2 | 0,155 | 0,13 | 0,38 | 18000 | 18000 | 24000 | 4700 | 1,5 | 0,25 | ramp-pref | comp | none | S1, S4, S16; ilk paso ≥ ap_min; özel yüzey (S17) 0,03–0,10 |
| melamine | 8 | 2 | 0,155 | 0,15 | 0,50 | 18000 | 18000 | 24000 | 5400 | 1,1 | 0,25 | ramp-pref | comp | none | S2, S4, S16; 2 × 9 mm |
| melamine | 10 | 2 | 0,28 | 0,20 | 0,59 | 18000 | 18000 | 24000 | 7200 | 0,9 | 0,25 | ramp-pref | comp | none | S1, S2, S4 |
| melamine | 12 | 2 | 0,28 | 0,22 | 0,69 | 18000 | 18000 | 24000 | 7900 | 0,75 | 0,25 | ramp-pref | comp | none | S1, S2, S4 |
| solidWoodSoft | 3 | 2 | 0,10 | 0,10 | 0,15 | 18000 | 18000 | 24000 | 3600 | 1,0 | 0,25 | straight-ok | spiral | none | S1 |
| solidWoodSoft | 6 | 2 | 0,18 | 0,15 | 0,30 | 18000 | 18000 | 24000 | 5400 | 1,0 | 0,25 | straight-ok | spiral | none | S1, S9 |
| solidWoodSoft | 8 | 2 | 0,25 (T) | 0,15 | 0,39 (T) | 18000 | 18000 | 24000 | 5400 | 0,75 | 0,25 | straight-ok | spiral | none | S1 ara değer |
| solidWoodSoft | 12 | 2 | 0,51 | 0,22 | 0,58 | 18000 | 18000 | 24000 | 7900 | 0,5 | 0,25 | straight-ok | spiral | none | S1 |
| solidWoodHard | 3 | 2 | 0,05 | 0,06 | 0,13 | 18000 | 18000 | 24000 | 2200 | 0,5 | 0,25 | ramp-pref | spiral | none | S1, S2 |
| solidWoodHard | 4 | 2 | 0,10 | 0,08 | 0,15 | 18000 | 18000 | 24000 | 2900 | 0,5 | 0,25 | ramp-pref | spiral | none | S2 |
| solidWoodHard | 6 | 2 | 0,127 | 0,10 | 0,28 | 18000 | 18000 | 24000 | 3600 | 0,5 | 0,25 | ramp-pref | spiral | none | S1, S2, S3, S9 |
| solidWoodHard | 8 | 2 | 0,137 | 0,12 | 0,37 | 18000 | 18000 | 24000 | 4300 | 0,5 | 0,25 | ramp-pref | spiral | none | S2, S3 |
| solidWoodHard | 10 | 2 | 0,163 | 0,14 | 0,48 | 18000 | 18000 | 24000 | 5000 | 0,5 | 0,25 | ramp-pref | spiral | none | S1, S2, S3 |
| solidWoodHard | 12 | 2 | 0,145 | 0,15 | 0,53 | 18000 | 18000 | 24000 | 5400 | 0,5 | 0,25 | ramp-pref | spiral | none | S1, S2, S3 |
| acrylic | 3 | 1 | 0,10 | 0,10 | 0,15 | 14000 | 18000 | 22000 | 1800 | 0,5 | 0,5 | ramp-req | oflute | air | S5, S13, S15 |
| acrylic | 4 | 1 | 0,15 | 0,12 | 0,20 | 14000 | 18000 | 22000 | 2200 | 0,5 | 0,5 | ramp-req | oflute | air | S5 |
| acrylic | 6 | 1 | 0,11 (T) | 0,167 | 0,33 (T) | 14000 | 18000 | 22000 | 3000 | 0,5 | 0,5 | ramp-req | oflute | air | S5, S12, S13; XT: paso yarıya |
| acrylic | 8 | 1 | 0,23 | 0,20 | 0,33 | 14000 | 18000 | 22000 | 3600 | 0,5 | 0,5 | ramp-req | oflute | air | S5, S2 |
| acrylic | 10 | 1 | 0,28 | 0,22 | 0,41 | 14000 | 18000 | 22000 | 4000 | 0,5 | 0,5 | ramp-req | oflute | air | S5 |
| acrylic | 12 | 1 | 0,38 | 0,25 | 0,51 | 14000 | 16000 | 18000 | 4000 | 0,5 | 0,5 | ramp-req | oflute | air | S5, S15 (16–18k) |
| acrylic | 6 | 2 | 0,13 | 0,12 | 0,25 | 14000 | 18000 | 22000 | 4300 | 0,5 | 0,5 | ramp-req | spiral (up) | air | S1, S2 |
| acrylic | 8 | 2 | 0,17 (T) | 0,14 | 0,28 | 14000 | 18000 | 22000 | 5000 | 0,5 | 0,5 | ramp-req | spiral (up) | air | S1 ara değer, S2 |
| pvcFoam | 3 | 1 | 0,10 | 0,10 | 0,15 | 14000 | 18000 | 22000 | 1800 | 1,0 | 0,5 | ramp-pref | oflute | air | S5 |
| pvcFoam | 6 | 1 | 0,15 | 0,20 | 0,30 | 14000 | 18000 | 22000 | 3600 | 1,0 | 0,5 | ramp-pref | oflute | air | S1, S2, S5 |
| pvcFoam | 8 | 1 | 0,22 | 0,22 | 0,33 | 14000 | 18000 | 22000 | 4000 | 1,0 | 0,5 | ramp-pref | oflute | air | S2, S5 |
| pvcFoam | 12 | 1 | 0,30 | 0,28 | 0,51 | 14000 | 18000 | 22000 | 5000 | 0,75 | 0,5 | ramp-pref | oflute | air | S1, S5 |
| pvcFoam | 6 | 2 | 0,15 | 0,15 | 0,24 | 14000 | 18000 | 22000 | 5400 | 1,0 | 0,5 | ramp-pref | spiral (up) | air | S1, S2 |
| pvcFoam | 8 | 2 | 0,22 | 0,17 | 0,28 | 14000 | 18000 | 22000 | 6100 | 1,0 | 0,5 | ramp-pref | spiral (up) | air | S2 |
| pvcRigid | 3 | 1 | 0,05 | 0,08 | 0,15 | 14000 | 18000 | 22000 | 1400 | 0,5 | 0,5 | ramp-req | oflute | air | S1, S5 |
| pvcRigid | 6 | 1 | 0,13 | 0,15 | 0,30 | 14000 | 18000 | 22000 | 2700 | 0,5 | 0,5 | ramp-req | oflute | air | S1, S2, S5 |
| pvcRigid | 8 | 1 | 0,18 | 0,18 | 0,33 | 14000 | 18000 | 22000 | 3200 | 0,5 | 0,5 | ramp-req | oflute | air | S2, S5 |
| pvcRigid | 6 | 2 | 0,13 | 0,12 | 0,22 | 14000 | 18000 | 22000 | 4300 | 0,5 | 0,5 | ramp-req | spiral (up) | air | S1, S2 |
| pvcRigid | 8 | 2 | 0,18 | 0,14 | 0,24 | 14000 | 18000 | 22000 | 5000 | 0,5 | 0,5 | ramp-req | spiral (up) | air | S2 |
| aluminium | 3 | 1 | 0,05 | 0,05 | 0,127 | 18000 | 18000 | 24000 | 900 | 0,25 | 0,3 | ramp-req | oflute | mql | S1, S2, S6 |
| aluminium | 4 | 1 | 0,05 | 0,05 | 0,133 | 14600 | 18000 | 24000 | 900 | 0,25 | 0,3 | ramp-req | oflute | mql | S2, S6 |
| aluminium | 6 | 1 | 0,076 | 0,075 | 0,18 | 9700 | 18000 | 24000 | 1400 | 0,25 | 0,3 | ramp-req | oflute | mql | S1, S2, S6; rpm min = 183 m/dk (T) |
| aluminium | 8 | 1 | 0,10 | 0,10 | 0,20 | 7300 | 16000 | 19900 | 1600 | 0,25 | 0,3 | ramp-req | oflute | mql | S2, S6, S11 |
| aluminium | 10 | 1 | 0,10 | 0,10 | 0,21 | 5800 | 14000 | 15900 | 1400 | 0,25 | 0,3 | ramp-req | oflute | mql | S1, S2, S6, S11 |
| aluminium | 12 | 1 | 0,15 | 0,15 | 0,25 | 4900 | 12000 | 13300 | 1800 | 0,25 | 0,3 | ramp-req | oflute | mql | S1, S2, S6, S11 |
| aluminium | 6 | 2 | 0,05 | 0,05 | 0,155 | 9700 | 18000 | 24000 | 1800 | 0,25 | 0,3 | ramp-req | spiral (ZrN) | mql | S2, S7, S11 |
| aluminium | 8 | 2 | 0,064 | 0,06 | 0,187 | 7300 | 16000 | 19900 | 1900 | 0,25 | 0,3 | ramp-req | spiral (ZrN) | mql | S2, S11 |
| acm (kontur) | 3 | 1 | 0,05 | 0,06 | 0,21 (T) | 18000 | 18000 | 24000 | 1100 | 0,5 | 0,3 | ramp-req | oflute | air | S6 alt sınır, S19 türetilmiş üst |
| acm (kontur) | 6 | 1 | 0,076 | 0,11 | 0,21 (T) | 18000 | 18000 | 24000 | 2000 | tam (≤ 4 mm) | 0,3 | ramp-req | oflute | air | S6, S18, S19 |
| acm (kontur) | 8 | 1 | 0,10 | 0,14 | 0,21 (T) | 18000 | 18000 | 24000 | 2500 | tam (≤ 4 mm) | 0,3 | ramp-req | oflute | air | S6, S19 |
| acm (V-kanal) | V 90°/135° | 2 | 0,025 | 0,04 | 0,05 | 18000 | 18000 | 24000 | 1500 | tek paso, kalan 0,7–0,8 mm | 0,3 | ramp-req | vgroove | none | S8 (alüminyum satırı), S18, S20, S21 |
| brass | 3 | 2 | 0,025 | 0,015 | 0,025 | 18000 | 24000 | 24000 | 700 | 0,15 | 0,3 | ramp-req | spiral | mql | yalnızca S11; zayıf |
| brass | 6 | 2 | 0,05 | 0,03 | 0,05 | 18000 | 18000 | 19400 | 1100 | 0,15 | 0,3 | ramp-req | spiral | mql | S11; vc 365 → 19 400 rpm (T) |
| brass | 8 | 2 | 0,056 | 0,035 | 0,056 | 14000 | 14000 | 14500 | 1000 | 0,15 | 0,3 | ramp-req | spiral | mql | S11 |
| copper | 6 | 2 | 0,05 | 0,025 | 0,05 | 18000 | 18000 | 19400 | 900 | 0,15 | 0,3 | ramp-req | spiral | mql | S11 (pirinçle aynı satır); yapışkan, Ö: pirinç × 0,8 |
| steel, stainless | – | – | – | – | – | – | – | – | – | – | – | – | – | – | önerilmez (b.12) |

**Ek kurallar (kod için):**

- Derinlik düzeltmesi [S1, S3, S9]: `depth ≤ 1 × D` → chip load tablo değeri; `2 × D` → × 0,75; `3 × D` → × 0,5. Arası doğrusal (Ö). Melamin Ø6 satırındaki 0,13 bu düzeltmenin sonucudur: 0,155 × (1 − 0,25 × 0,5) ≈ 0,136 (T).
- Melamin + compression: `ilk paso derinliği ≥ ap_min` (takımın aşağı helis boyu; Leitz örneklerinde 5–8 mm [S16]). Takım tablosunda bu boy bir alan olmalı (§f).
- Rampa iniş feed'i: `feed / flutes` [S3]. Uygulamada `plungeFeed` tek değer olduğu için tablo oranı (`plunge`) temkinli tarafta seçildi.
- Chip load uyarı bandı: `cl < cl_min × 0,8` → "çok düşük: ısınma, erime" uyarısı; `cl > cl_max` → "çok yüksek: kırılma, kötü yüzey" uyarısı (Ö). `spindle.ts` zaten chip load hesaplıyor.

---

## d) Temkinli başlangıç değerleri (Ø6 ve Ø8)

Seçim kuralı (Ö): chip load kaynak aralığının alt ucunda (çok düşük chip load'un ısı sorununu yaşatmayacak kadar, ama en temkinli endüstriyel tabloya yakın), devir tablo devri (18 000 rpm) ya da metalde kesme hızından, paso derinliği 0,25–1 × D, dalma oranı %25–50 ve plastik/metalde rampa. İlk kesim **havada deneme (air cut) + hurda parçada deneme** ile yapılır [S1, S9]. Feed değerleri `feed = cl × z × rpm` ile hesaplandı (T) ve 100'e yuvarlandı.

### Uygulamadaki malzemeler

| material | Ø | z | tool | rpm | feed mm/dk | plungeFeed mm/dk | stepDown mm | chip load (T) | 18 mm için paso | gerekçe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mdf | 6 | 2 | spiral | 18000 | 5400 | 1400 | 6 | 0,150 | 3 | Amana ve ShopBot değeri [S3, S9]; Freud/Rennie'nin yarısı |
| mdf | 8 | 2 | spiral | 18000 | 6000 | 1500 | 6 | 0,167 | 3 | **mevcut değer korunur**; kaynak aralığının altında, 0,75 × D |
| plywood | 6 | 2 | spiral | 18000 | 4700 | 1200 | 6 | 0,131 | 3 | Amana wood/ply 0,127 [S3]; Freud alt ucu 0,15 [S1] |
| plywood | 8 | 2 | spiral | 18000 | 5000 | 1300 | 6 | 0,139 | 3 | Amana 5/16" 0,137 [S3]; MDF'den %15 düşük; yüzey kaplaması için temkin |
| melamine | 6 | 2 | compression | 18000 | 4700 | 1200 | 9 | 0,131 | 2 | Amana compression 0,155 [S4] − %12 (1,5 × D düzeltmesi [S1]); ilk paso ≥ ap_min [S16] |
| melamine | 8 | 2 | compression | 18000 | 5400 | 1400 | 9 | 0,150 | 2 | Amana compression 1/4" değeri [S4]; 9 mm ≈ 1,1 × D; ilk paso ≥ ap_min [S16] |
| melamine | 8 | 2 | spiral (aşağı helis) | 18000 | 5000 | 1300 | 6 | 0,139 | 3 | compression yoksa; üst yüz temiz, alt yüz kırılabilir (uyarı) |
| solidWoodSoft | 6 | 2 | spiral | 18000 | 5400 | 1400 | 6 | 0,150 | 3 | ShopBot alt ucu 0,18 [S9] altında; Freud 0,25 [S1] |
| solidWoodSoft | 8 | 2 | spiral | 18000 | 5400 | 1400 | 6 | 0,150 | 3 | Freud ara değer (T) 0,25'in çok altında; lif yırtılmasına karşı temkin |
| solidWoodHard | 6 | 2 | spiral | 18000 | 3600 | 900 | 3 | 0,100 | 6 | Amana wood 0,127 [S3] altında; 0,5 × D |
| solidWoodHard | 8 | 2 | spiral | 18000 | 4300 | 1100 | 4 | 0,119 | 5 | Amana 0,137 [S3] altında; 0,5 × D |
| acrylic (GS) | 6 | 1 | O-flute | 18000 | 3000 | 1500 | 3 | 0,167 | (10 mm: 4) | Leitz türetilmiş 0,17–0,22 [S13]; Amana 0,20 altında [S5]; Acrylite 0,5 × D [S15] |
| acrylic (GS) | 8 | 1 | O-flute | 18000 | 3600 | 1800 | 4 | 0,200 | (10 mm: 3) | Amana 8 mm alt ucu 0,23 [S5] altında; Rennie 0,229 [S2] |
| acrylic (XT) | 6 | 1 | O-flute | 18000 | 3000 | 1500 | 2 | 0,167 | (10 mm: 5) | XT ısıya daha duyarlı [S12]: feed aynı (düşürmek erimeyi artırır), paso küçük, hava zorunlu |
| acrylic | 6 | 2 | spiral (yukarı) | 18000 | 4300 | 2100 | 3 | 0,119 | – | Freud hard plastic alt ucu 0,13 [S1]; O-flute yoksa |
| acrylic | 8 | 2 | spiral (yukarı) | 18000 | 5000 | 2500 | 4 | 0,139 | – | Freud ara değer (T) |
| pvcFoam | 6 | 1 | O-flute | 18000 | 3600 | 1800 | 6 | 0,200 | (10 mm: 2) | Freud soft 0,15–0,23 [S1], Amana 0,20 [S5] |
| pvcFoam | 8 | 1 | O-flute | 18000 | 4000 | 2000 | 8 | 0,222 | (10 mm: 2) | Rennie soft 0,221 [S2], Amana 0,23 [S5] |
| pvcFoam | 6 | 2 | spiral (yukarı) | 18000 | 5400 | 2700 | 6 | 0,150 | – | Freud soft alt ucu [S1] |
| pvcFoam | 8 | 2 | spiral (yukarı) | 18000 | 6100 | 3000 | 8 | 0,169 | – | Rennie soft altında [S2] |
| pvcRigid | 6 | 1 | O-flute | 18000 | 2700 | 1300 | 3 | 0,150 | – | Rennie hard 0,148 [S2] |
| pvcRigid | 8 | 1 | O-flute | 18000 | 3200 | 1600 | 4 | 0,178 | – | Rennie hard 0,181 [S2] |
| pvcRigid | 6 | 2 | spiral (yukarı) | 18000 | 4300 | 2100 | 3 | 0,119 | – | Freud hard 0,13 [S1] altında |
| pvcRigid | 8 | 2 | spiral (yukarı) | 18000 | 5000 | 2500 | 4 | 0,139 | – | Rennie hard altında [S2] |

Not: uygulamanın `solidWood` ve `pvc` türleri bugün tek tür. Yukarıdaki ayrım (yumuşak/sert, köpük/sert) ya alt tür ya da yeni `MaterialKind` olarak modellenmeli (§f).

### Aday malzemeler

| material | Ø | z | tool | rpm | feed mm/dk | plungeFeed mm/dk | stepDown mm | chip load (T) | gerekçe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aluminium | 6 | 1 | O-flute (ZrN) | 18000 | 1400 | 400 | 1,5 | 0,078 | Amana alt ucu 0,076 [S6]; 0,25 × D (Sorotec 0,5 × D'nin yarısı [S11]) |
| aluminium | 8 | 1 | O-flute (ZrN) | 16000 | 1600 | 500 | 2 | 0,100 | Amana alt ucu 0,10 [S6]; vc 402 m/dk (T) |
| aluminium | 6 | 2 | spiral ZrN | 18000 | 1800 | 500 | 1,5 | 0,050 | Amana 2 ağız 0,051 [S7], Sorotec 0,050 [S11] |
| aluminium | 8 | 2 | spiral ZrN | 16000 | 1900 | 600 | 2 | 0,059 | Sorotec 0,064 [S11] altında |
| acm (kontur) | 6 | 1 | O-flute | 18000 | 2000 | 600 | 4 (tek paso) | 0,111 | Alucobond 0,21 (T) [S19] yarısı; alüminyum O-flute aralığı [S6] |
| acm (kontur) | 8 | 1 | O-flute | 18000 | 2500 | 750 | 4 (tek paso) | 0,139 | aynı |
| acm (V-kanal) | V 90° düz taban | 2 | vgroove | 18000 | 1500 | 450 | kalan 0,7–0,8 mm | 0,042 | Amana ACM alüminyum satırı 3–5 mm: 0,9–1,8 m/dk [S8]; derinlik [S18, S20, S21] |
| brass | 6 | 2 | spiral | 18000 | 1100 | 300 | 0,9 | 0,031 | Sorotec 0,05 [S11] altında; zayıf veri |
| copper | 6 | 2 | spiral | 18000 | 900 | 300 | 0,9 | 0,025 | pirinçten %20 düşük (Ö); MQL şart |

Bu adaylarda §f'deki yazılım ön koşulları (soğutma kodu, V-kanal işlemi, Z referansı) karşılanmadan değerleri yayımlamak önerilmez.

---

## Alüminyum ve ACM: yazılımın yapması gereken değişiklikler

1. **Soğutma kodu ayrı olmalı.** Alüminyum ve pirinç MQL, sis ya da hava ister [S11, S29]. Örnek profilde vakum `M7` ile açılıyor (`holdDown.vacuumOn: 'M7'`); M7 standart olarak sis soğutmadır. Post'ta `coolant: { on, off }` ayrı alan olmalı ve vakum kodu ile çakışma kontrol edilmeli.
2. **Rampa zorunlu, düz dalış yasak** (metal ve plastik için malzeme bazlı varsayılan). Uygulamada 3° zig-zag rampa var; delikler için heliks giriş eklenmeli.
3. **Paso derinliği çok küçük** (0,25–0,5 × D). Paso sayısı artar; süre tahmini ve uyarılar buna göre.
4. **Çapak alma pasosu** (chamfer/deburr, V uçla kenar boyunca sığ geçiş) isteğe bağlı yeni işlem olarak.
5. **ACM V-kanal katlama işlemi**: açık hat (katlama çizgisi) üzerinde V takımıyla tek paso; derinlik **"kalan kalınlık"** olarak girilir (0,7–0,8 mm [S18, S20, S21]). Panelin kalınlık toleransı ±0,2 mm [S18, S28] olduğu için derinlik **masa (destek levhası) yüzeyinden** ölçülmeli: panel yüzü aşağı yattığı için dış alüminyum yüz masadadır ve kalan kalınlık masaya göre sabittir. Bugünkü `zZero.reference: 'materialTop'` bunu karşılamaz; işlem bazında Z referansı ya da "malzeme kalınlığını ölç" adımı gerekir.
6. **Arka yüzden işleme = aynalama.** V-kanal arka yüzde açılır, panel yüzü aşağı yatar; parça çizimi aynalanmalı ve bu ekranda açıkça gösterilmeli.
7. **Takım modelinde V-kanal alanları:** `vBit` için açı (90/108/135/155° [S8]) ve düz taban genişliği (Dibond en az 3,2 mm [S18]) gerekir. Bugünkü `toolSchema`'da yalnız çap, kanal boyu ve ağız sayısı var.
8. **Köprü ve tutma.** Alüminyumda köprü elle koparılmaz; ince köprü + çapak alma, ya da bant/vida ile tutma seçeneği (Ö). Alüminyum talaşı vakum masasını çizer; iş sonu temizlik uyarısı (Ö).
9. **Kesim yönü malzeme bazlı varsayılan:** ACM ve akrilikte karşı yön (conventional) [S15, S19].
10. **Devir kesme hızından hesaplanmalı:** alüminyumda büyük çapta devir düşmeli (Ø12'de ≈ 12 000 rpm) [S6, S11]; tek bir "18 000 rpm" varsayılanı metalde yanlış.

---

## e) Kaynaklar

Erişim tarihi: hepsi **2026-11-23**. "Kopya" yazanlar, belgenin üretici dışı bir sunucudaki kopyasıdır; içerik üretici belgesidir.

| # | Kaynak | URL |
| --- | --- | --- |
| S1 | Freud (Bosch Group), "Get the most out of your Freud bits by routing at ideal feed rates and speeds", 2017 | https://www.freudtools.com/public/assets/freud/downloadables/freudtools-router-bit-feed-and-speed-for-cnc-20170822.pdf |
| S2 | Rennie Tool (UK), "Solid Carbide Router Bits Speeds And Feeds", 2021 | https://www.rennietool.co.uk/blogs/news/solid-carbide-router-bits-speeds-and-feeds |
| S3 | Amana Tool, "2 & 3 Flute Solid Carbide Spiral Plunge Router Bits" speed chart v19 | https://www.amanatool.com/pub/media/productattachments/Solid-Carbide-Spiral-Plunge-2-3-Flute-v19.pdf |
| S4 | Amana Tool, "Solid Carbide Compression Spiral Router Bits" chart v12 | https://cdn.shopify.com/s/files/1/1558/5651/files/Solid-Carbide-Compression-Spirals-v12.pdf |
| S5 | Amana Tool, "Solid Carbide Plastic Cutting Spiral Single 'O' Flute" chart v9; Spektra sürümü v19 | https://cdn.shopify.com/s/files/1/1558/5651/files/Plastic-O-Flute-Speed-Chart-v9.pdf · https://www.amanatool.com/pub/media/productattachments/Spektra-Plastic-O-Flute-Speed-Chart-v19.pdf |
| S6 | Amana Tool, "Solid Carbide Aluminum Cutting Spiral Single 'O' Flute" chart v9; ZrN sürümü v14 | https://cdn.shopify.com/s/files/1/1558/5651/files/Aluminum-O-Flute-Speed-Chart-v9.pdf · https://www.amanatool.com/pub/media/productattachments/ZrN-Aluminum-O-Flute-Speed-Chart-v14.pdf |
| S7 | Amana Tool, "Solid Carbide ZrN Coated Square Aluminum Cutting End Mill" v2 | https://www.amanatool.com/pub/media/productattachments/Aluminum_cutting_Square_end_mill_v2.pdf |
| S8 | Amana Tool, "2 Flute Double Edge V-Grooving Carbide Tipped Router Bits with Flat Bottom for ACM Materials" v7 | https://cdn.shopify.com/s/files/1/1558/5651/files/Carbide-Tipped-ACM-Double-Edge-V-Groove-Speed-Feed-Chart-v7.pdf |
| S9 | ShopBot Tools, "Feeds and Speeds Charts" SBG 00200, 2014 (Onsrud verisi) (kopya; resmi adres support.shopbottools.com sertifika hatası verdi) | https://bklevence.github.io/assets/docs/shopbot/feeds-and-speeds.pdf |
| S10 | Onsrud Cutter, chip load tabloları: MDF, Hard Wood, Soft Wood, Hard Plywood, Hard Plastic (WoodWeb kopyası) | https://www.woodweb.com/knowledge_base_images/zp/Chipload_MDF.pdf · https://www.woodweb.com/knowledge_base_images/zp/Chipload_Hard_Plywood.pdf · https://www.woodweb.com/images_forums_public/cnc/Hard_Plastic.pdf |
| S11 | Sorotec GmbH, "Cutting parameters: Calculation and practical hints" v1.0.1 | https://webseite.sorotec.de/download/fraesparameter/schnittwerte_en.pdf |
| S12 | LEUCO, "Plastics processing: acrylic glass, PMMA" | https://www.leuco.com/EN/AU/media/DOK_MBR_LEUCO-Kunststoffbearbeitung_DL.pdf |
| S13 | Leitz, "Tools for PMMA" | https://lexicon.leitz.org/media/attribute/image/t/o/toolsforpmma.pdf |
| S14 | Polyvantis (Röhm), "PLEXIGLAS Guidelines for Workshop Practice: Machining", Ref. 311-1, 07/24 (Zenit kopyası) | https://www.zenit.cz/public/media/Plasty/Zenit_Montaz_Plasty_Plexiglas_Zpracovani_AJ.pdf |
| S15 | Polyvantis Sanford (ACRYLITE), "Routing extruded acrylic" tech brief, 2021 | https://www.acrylite.co/tech-briefs/routing-extruded-acrylic.html |
| S16 | Leitz, "Processing recommendation EGGER Eurodekor and Eurodekor Plus boards", 2021 (Richelieu kopyası) | https://static.richelieu.com/documents/docsGr/123/224/4/1232244/1585605.pdf |
| S17 | LEUCO, "Processing instructions EGGER PerfectSense panels" | https://www.leuco.com/EN/AU/media/DOK_MBR_Verarbeitungshinweis-EGGER-PerfectSense_DL.pdf |
| S18 | 3A Composites USA, "DIBOND Fabrication Manual", Nisan 2018 (JP Plus kopyası) | https://jpmagento-public.s3.amazonaws.com/landing-pages/signsubstrates/dibond/JPP_Dibond-Fabrication-Manual.pdf |
| S19 | 3A Composites, "ALUCOBOND Processing and Technical Data", Edition 3 | https://www.alucobond.com/files/downloads/produkte/en/ALUCOBOND_processing_EN.pdf |
| S20 | 3A Composites, "ALUCOBOND Edge bending" | https://alucobond.com/files/downloads/produkte/en/ALUCOBOND_Edge_bending_EN.pdf |
| S21 | 3A Composites Singapur, "Alucolux Processing Guide" | https://alucobond.com.sg/media/2026/03/Alucolux-Processing-Guide-2.pdf |
| S22 | 3A Composites USA, "The Foamed PVC Family Fabrication Manual" (Sintra), Mayıs 2018 (JP Plus kopyası) | https://jpmagento-public.s3.amazonaws.com/landing-pages/signsubstrates/sintra/JPP_Sintra-Fabrication-Manual.pdf |
| S23 | Leitz, "Tools for compact laminate" | https://lexicon.leitz.org/media/attribute/image/t/o/toolsforcompactlaminate28en29.pdf |
| S24 | Kastamonu Entegre, "Medepan teknik özellikler" 350-TS-001 rev. 2; ürün kataloğu | https://www.kastamonuentegre.com/uploads/2023/01/004-ts-001-2-medepan-teknik-ozellikleri-1.pdf · https://kastamonuentegre.com/uploads/2022/12/product-catalogue-2.pdf |
| S25 | HSE (UK), "Wood dust" | https://www.hse.gov.uk/woodworking/wooddust.htm |
| S26 | Türkiye perakende ilanları (kontrplak ebat ve kalınlık): Sveza huş kontrplak 125 × 250 cm (n11); kayın kontrplak kalınlıkları (cimri) | https://www.n11.com/urun/sveza-filimsiz-kontrplak-rus-birch-wbp-tutkalli-18-mm-125x250cm-70779847 · https://www.cimri.com/kontraplak |
| S27 | Autodesk, "About ramping moves" (ArtCAM help) | https://help.autodesk.com/cloudhelp/2018/ENU/ARTC-ReferenceHelp/files/GUID-95DCCD78-BB95-40F8-A375-830DABAB0EE9.htm |
| S28 | ASAŞ, "Alfabond" alüminyum kompozit panel teknik broşürü (bayi kopyası) | https://aks-pro.vercel.app/pdf/kompozit-paneller/alfabond.pdf |
| S29 | DATRON, "Optimal milling speed for aluminum" | https://www.datron.com/resources/blog/milling-speed-for-aluminum-optimal-rates/ |


İkincil kaynaklar (yalnız açık madde olarak anıldı, sayıları tabloya girmedi): CNCCookbook rampa açısı yazısı (https://www.cnccookbook.com/helical-interpolation-ramp-angle-and-the-best-ways-to-enter-a-cut/), Amana ürün sayfaları ve forum aktarımları (arama özetleri; bazı sayfalar 429 hata verdi).

Okunamayan ya da kullanılamayan kaynaklar: ShopBot resmi adresi (sertifika hatası, kopya kullanıldı), Dibond Curbell kopyası (PDF yerine HTML döndü, JP Plus kopyası kullanıldı), Egger Eurodekor Leuco sürümü (HTML döndü, Leitz sürümü kullanıldı), 3A Forex föyü (HTML döndü), HSE MDF SSS sayfası (404), Onsrud tablolarında seri-çap sütun hizası (PDF metninden güvenle okunamadı, sayı olarak yalnız ShopBot'un aktardığı değerler kullanıldı).

---

## f) Açık maddeler

1. **Kaynaklar arası 2–4 kat fark.** Hangi tablo "doğru" sorusu makineye bağlıdır. Öneri: başlangıç değerleri alt uçta kalsın, uygulama operatörün onayladığı değeri kaydetsin; ileride atölyeden gelen onaylı değerler (anonim) bu tabloyu düzeltebilir (insan kapısı: veri toplama kapsamı).
2. **Rampa açısı** için malzeme bazlı üretici değeri bulunamadı. Uygulamanın 3° değeri korunmalı; alüminyumda 2–3° ile deneme yapılmalı (makine testi, insan kapısı).
3. **Compression takımın `ap_min` (aşağı helis boyu)** takım tablosunda alan değil. Melamin kalitesi için gerekli; takım modeline eklenmeli mi (kapsam kararı)?
4. **`solidWood` ve `pvc` türlerinin bölünmesi** (yumuşak/sert, köpük/sert). `MaterialKind` listesi değişirse profil şeması ve sihirbaz etkilenir (spec §3.6, kapsam kararı).
5. **ACM V-kanal feed'i**: Amana tablosu (0,9–1,8 m/dk) ile Alucolux makine örneği (≤ 8 m/dk) arasında büyük fark var. Makinede denenmeli.
6. **ACM ve alüminyum için Z referansı** (masa yüzeyi ya da ölçülen kalınlık). Bugünkü `zZero` modeli işlem bazında referans desteklemiyor (tasarım kararı).
7. **Türkiye levha ebatları**: akrilik, dekota/foreks, alüminyum levha ve kontrplak (122 × 244, 170 × 220) için güvenilir kaynak bulunamadı. Tedarikçi kataloğu (ör. Kastamonu dışında Yıldız Entegre, AGT, ASAŞ alüminyum levha) ile doğrulanmalı.
8. **Pirinç ve bakır** için tek tablo (Sorotec, hobi) var; Amana gravür tablosu bu çalışmada okunamadı. Gravür işlemi ayrı tasarlanmadan bu malzemeler eklenmemeli.
9. **Polikarbonat ve HDPE**: malzeme üreticisi (Covestro, Palram, Röchling) kılavuzu bulunmalı.
10. **PVC ısıl bozunma** notu genel bilgiye dayanıyor; malzeme güvenlik bilgi formu ile kaynaklanmalı.
11. **Hava soğutma ve MQL için post desteği**: hangi kontrol ünitesi (Mach3, NC Studio, Syntec, DSP) hangi kodu kullanıyor, makine kütüphanesiyle birlikte toplanmalı.


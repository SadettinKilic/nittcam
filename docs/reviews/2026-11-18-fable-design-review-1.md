# Fable tasarım incelemesi #1 (2026-11-18)

Kapsam: M2 sonu (`main`, PR #34–#37). Bağımsız ürün tasarımcısı gözüyle inceleme.
Yöntem: uygulama boş bir veritabanıyla çalıştırıldı; Ana sayfa (boş + projeli), Makineler listesi + formu, Doğrulama, sihirbaz 1–5 (5 satırlık kesim listesi yapıştırılıp dizildi), Projeler, `/dev/ui`, komut paleti ve mobil çekmece 1440×900 ve 390×844'te, açık ve koyu temada ekran görüntüsü alınıp tek tek bakıldı. `packages/ui/src/tokens.css` ve `ui-conventions` okundu. Tam e2e çalıştırılmadı; ürün koduna dokunulmadı.

Kıyas: Linear, Vercel, Figma, Onshape, Fusion 360 web, Autodesk Construction Cloud.

## 1. Karar özeti

| Başlık | Puan | Tek cümle |
| --- | --- | --- |
| Kurumsal imaj | **5 / 10** | Temiz ama kimliksiz: ekranda logo yok, "NittCam" adı hiçbir yerde görünmüyor. |
| Modernlik | **7 / 10** | Kabuk, palet, koyu tema ve token disiplini 2026 seviyesinde; tuvaller (dizilim, simülasyon) o seviyede değil. |
| Kullanılabilirlik | **6,5 / 10** | Akış anlaşılır ve Türkçe; ama dizilim/simülasyon uzun bir "belge sayfası", telefonda tuval en altta, uyarılar fazla. |
| M3–M6'ya hazırlık | **6 / 10** | Bileşen ve token temeli sağlam; çizim tahtası ve 3D'nin oturacağı "çalışma alanı" düzeni ve tuval görsel dili henüz yok. |

Genel hüküm: "Demode" sorunu çözülmüş. "Beyaz üstüne turuncu buton" kalmamış. Ama şu an ekran, iyi yapılmış **herhangi bir** SaaS paneli gibi duruyor; bir CNC/CAM ürünü olduğu ancak dizilim adımına gelince anlaşılıyor ve ürünün kalbi olan tuvaller en zayıf görünen yerler. "Klas ve kurumsal" için eksik olan süs değil, **kimlik** ve **tuval kalitesi**. İkisi de M3 başlamadan küçük işlerle kapatılabilir; aksi halde M3–M6'daki her yeni ekran aynı eksiği devralır.

## 2. En önemli 10 bulgu (etki sırasıyla)

### 1. Marka yok: logo, yazı markası, favicon yok
- Ekran: bütün ekranlar. Sol üstte "A · Atölyem / Operatör" kutusu markanın yerinde duruyor. "NittCam" yalnızca sekme başlığında; `app/` altında ikon dosyası yok.
- Neden önemli: sahibinin ilk isteği "kurumsal imaj". Linear, Vercel, Onshape'te sol üst köşe markadır; çalışma alanı adı ikincildir.
- Çözüm: toolpath'ten çizilmiş "N" monogramı + "NittCam" yazı markası (SVG, kod içinde), favicon/uygulama ikonları, logo sol üstte; şirket kutusu kenar çubuğunun altına hesap satırı olarak iner. → **T194** (FQ1, FQ2).

### 2. Tuvaller ürünün kalbi ama en zayıf görünen yer
- Ekran: Dizilim (3. adım), Simülasyon (4. adım), 1. adım "Önizleme", Ana sayfa proje kartı.
- Gözlem: parçalar düz açık mavi kutular, etiket yalnızca "2.1"; parça adı, ölçü, plaka ölçüsü, cetvel yok. 1. adım önizlemesi boş bir dikdörtgen ve dev bir ok. Simülasyon t=0'da hiç takım yolu göstermiyor: boş beyaz kutular. **Koyu temada simülasyonda parçalar (#161a20) zemin (#0f1115) üstünde neredeyse görünmüyor.**
- Kıyas: Onshape/Fusion'da tuval her zaman "dolu" ve ölçülüdür; değer oradan gelir.
- Çözüm: tuval görsel dili v1: ad + "En × Boy" etiketi (mono), plaka ölçü etiketleri, ölçek çubuğu, t=0'da soluk takım yolu "hayaleti", koyu tema kontrastı, "Diz" sonrası kısa yerleşme animasyonu, plaka sekmesinde kullanım çubuğu. → **T196**.

### 3. Dizilim ve simülasyon bir "çalışma alanı" değil, uzun bir sayfa
- Ekran: Dizilim 1440×900'de ~1.400 px, Simülasyon ~1.860 px yüksekliğinde. Plaka ekranın altında kesiliyor; oynatma düğmeleri ve G-code için kaydırmak gerekiyor; "Parça seç" tuvalin altında bir açılır liste.
- Neden önemli: çizim tahtası (M4) ve 3D (M6) aynı iskelete oturacak. Bugünkü kart yığını düzeniyle ikisi de sığmaz.
- Çözüm: `WorkspaceLayout`: solda daraltılabilir ayar paneli, ortada **ekran yüksekliğini dolduran** tuval, sağda denetçi (seçili parça / G-code); araç çubukları tuvalin üstünde yüzer; ≥1024 px'te sayfa kaydırması yok. → **T197**.

### 4. Telefonda/tablette tuval en altta
- Ekran: 390 px Dizilim: plakayı görmek için ~1.400 px ayar, özet ve uyarı kartı geçiliyor. Sabit alt çubuk ("Geri / İleri") içeriğin üstüne biniyor ("Diz" düğmesi çubuğun altında kalıyor). Kesim listesi tablosu 390'da yatay kayıyor, "Boy" sütunu kesik (kart modu T118'de planlı).
- Neden önemli: operatör makinenin başında tablet/telefonla bakacak; görmek istediği şey plaka.
- Çözüm: <1024 px'te önce tuval (≥ %55 yükseklik), ayarlar ve denetçi alt sayfa (bottom sheet); alt çubuk güvenli alanı ve içerik boşluğunu gözetir; 768 px birinci sınıf boyut. → **T198**.

### 5. Genel "shadcn" görünümü; tipografide teknik karakter yok
- Ekran: bütün ekranlar. Inter + kobalt + yuvarlak kartlar = binlerce panelle aynı. G-code ve dosya adları Windows'ta Consolas'a düşüyor (Dışa aktar > Dosyalar: satır kırılmış `s ha256`), kalitesiz duruyor. Sayfa başlıkları (30 px) içeriğe göre iri; sihirbazda adım adı hem adım çubuğunda hem altında ikinci kez H1 olarak yazıyor.
- Çözüm: ölçü, koordinat, G-code ve dosya adları için gömülü mono yazı tipi (Geist Mono / JetBrains Mono, OFL); başlıklar bir kademe küçülür; `Measure` bileşeni; kompakt yoğunluk token'ı. Teknik karakter = "mühendislik aleti" hissi. → **T195**.

### 6. Uyarı kalabalığı ve gereksiz kırmızı
- Ekran: Simülasyon: sarı bant + makine kartında kırmızı satır. Dışa aktar: örnek profil için dev kırmızı blok. Doğrulama: sağda sarı panel + mavi bilgi + sarı onay kutusu. 1. adımda da ayrı sarı kutu. Aynı "profil doğrulanmadı" mesajı 4 ekranda 5 kez.
- Neden önemli: her yeni kullanıcının normal durumu (örnek profil) "tehlike" kırmızısıyla gösterilirse gerçek tehlike geldiğinde kimse okumaz. Güvenlik iletişimi **daha az ve daha net** olmalı.
- Çözüm: tek kural (tehlike = şimdi engeller/risk; uyarı = bir kez onay; bilgi = bağlam), sihirbaz başlığında tek kalıcı "Doğrulanmadı" rozeti + ayrıntı açılır kutusu; hiçbir güvenlik cümlesi silinmez, indirme onayı aynen kalır. → **T199** (FQ3: dışa aktar adımındaki ton sahibin kararı).

### 7. Ana sayfa ve menü: tekrar ve "yakında" dolgusu
- Ekran: Ana sayfa. Aynı ekranda 4 adet "Yeni proje" (kenar çubuğu, başlık, boş durum, hızlı işlemler). Dördüncü KPI "Ortalama fire — / Yakında" boş kart. Menüde Şablonlar ve Ayarlar "yakında" rozetiyle canlı öğelerin arasında. "Oluştur" ile "Yeni proje" aynı sihirbazı açıyor; yeni projede "Oluştur", kaydedilince "Projeler" seçili görünüyor. Otomatik ad "Proje 18.11.2026 04:46".
- Çözüm: ekran başına tek birincil "Yeni proje"; boş KPI gizlenir; sıfır projede KPI yerine 3 adımlı başlangıç şeridi; "yakında" öğeleri altta soluk grup; "Adsız proje" + odaklı ad alanı. → **T194a** ("Oluştur"un kaldırılması FQ4).

### 8. İkonlar alan dilini konuşmuyor
- Ekran: Makineler listesi ve Ana sayfa (makine = işlemci çipi ikonu), menü (Makineler ikonu belirsiz), hızlı işlemler.
- Çözüm: 6 özel ikon (router/spindle, plaka, damar, dizilim, takım yolu, air cut), lucide ile aynı ızgara ve çizgi kalınlığı. → **T194a**.

### 9. Yoğunluk masaüstü profesyonel kullanım için gevşek
- Ekran: Kesim listesi (40 px satır + 4 ayrı kenar bandı sütunu, hepsi "0"), Dizilim ayarları, Makine formu.
- Not: 40 px dokunma hedefi tablet için doğru, kalsın. Ama çizim tahtasının özellik paneli ve 1.000 satırlık liste için 32–36 px kompakt mod şart; bu T183'e (M8) bırakılmış, geç.
- Çözüm: kompakt yoğunluk token'ı şimdi (T195), kullanıcı ayarı T183'te; T118 ve T130 kabul ölçütleri güncellendi (36 px satır, tek "Bant" hücresi, kompakt denetçi).

### 10. Hareket ve "havalı" an yok; dil tutarsızlıkları
- Ekran: "Diz"e basınca sonuç bir anda beliriyor; adım geçişleri, KPI'lar, kartlar tamamen statik. Token'larda süre/eğri tanımlı ama kullanılmıyor.
- Dil: "Bu hafta export", "Henüz export yok" ile "Dışa aktar" karışık; adım adı "Önizleme / simülasyon" iki kavram.
- Çözüm: anlamlı, kısa hareket (parçaların yerleşmesi ≤ 240 ms, 3D'de üstten izometriğe geçiş ≤ 400 ms; reduced-motion'da kapalı) → T196, T152. "export" → "dışa aktarma" → T194a.

## 3. İyi olanlar (koruyun)

- **Token sistemi**: anlamsal roller, Tailwind varsayılan paleti kapalı, AA kontrast testi (`tokens.test.ts`). Kıyaslanan ürünlerin çoğundan daha disiplinli.
- **Koyu tema**: sonradan boyanmış değil, gerçekten tasarlanmış; yüzey katmanları ve kenarlıklar doğru. (İstisna: simülasyon tuvali, bulgu 2.)
- **Komut paleti** (Ctrl+K): gruplar, kısayol ipuçları, son projeler; Linear sınıfında.
- **Kobalt vurgu**: doğru seçim; ciddi, teknik, "turuncu buton" algısının tam tersi. Tek vurgu kuralı kalsın. Öneri: turuncu/kehribar **yalnızca tuvalde** takım ve boşta hareket rengi olarak kalsın (bugünkü gibi); arayüz düğmelerine asla girmesin.
- **Sihirbaz adım çubuğu**: tamamlandı / geçerli / kilitli durumları, mobilde kompakt hali.
- **Doğrulama akışı**: adım adım, kontrol listeli, dosya + sha256; güven veren, kurumsal bir ekran.
- **Makine formu**: yan dizin, yapışkan kaydet çubuğu ("Değişiklik yok / Kaydet"), bölüm kartları.
- **Türkçe sayı biçimi** (3.050 × 2.150 mm, %43,6, ≈ 49 dk 33 sn) ve sade atölye dili.
- **Boş durumlar** ve otomatik kayıt göstergesi; tema değişince tuvalin canlı yeniden boyanması.

## 4. Önümüzdeki kilometre taşları için tasarım yönü

### 4.1 Marka kimliği
- **İşaret**: "N" harfi tek bir takım yolu gibi çizilir: kısa giriş (lead-in), iki dikey dalış, bir çapraz geçiş, sonda dolu bir takım noktası. 20 px'te bile okunur; ürünün ne yaptığını anlatır.
- **Yazı markası**: "NittCam", Inter 600, dar harf aralığı; "Cam" kısmı vurgu renginde. Koyu ve açık zeminde tek renk çalışır.
- **Renk**: kobalt kalır. Yanına ikinci bir arayüz rengi eklenmez. Tuvalde malzeme için sıcak, soluk ahşap tonu (M6'da 3D malzemelerle aynı aile) kimliğe sıcaklık katar; arayüz serin grafit kalır.
- **Motif**: ölçü çizgisi, nokta ızgara, ince çizgi illüstrasyon (boş durumlar ve başlangıç şeridi). Stok görsel ve 3D karakter yok.
- **Yazı**: Inter (arayüz) + mono (her türlü sayı, koordinat, G-code). "Sayılar mono" kuralı ürünün imzası olur.

### 4.2 Çizim tahtası (M4/M5)
- Düzen Figma/Onshape gibi: tuvalin sol kenarında dikey araç rayı (40 px, kısayol harfli ipucu), sağda kompakt özellik paneli, altta durum çubuğu (X/Y mono, yakalama anahtarları, yakınlaştırma %, birim).
- Tuval: en ince seviyede nokta ızgara; seçim = kobalt; yakalama kılavuzları = `info` (camgöbeği); ölçü etiketleri mono, küçük dolgulu rozet içinde; tutamaçlar 8 px kare, dokunmada 12 px.
- İmleç yanında canlı ölçü kutusu (yazarak uzunluk girme) en "profesyonel CAD" hissini veren ayrıntıdır; T128'de öne çıkarılmalı.
- T124 ve T130 kabul ölçütleri bu yönde güncellendi.

### 4.3 Damar kadranı (M3, T115)
- 120 px kadran (açılır kutu ve tablo hücresi için 72 px); dış halkada 15°'de bir çentik, 0/45/90/135'te uzun çentik + etiket.
- **Tutamaç bir çap çizgisi ve iki ucunda da kulp**: damarın yönü yoktur; "30° ile 210° aynı" bilgisi yazıyla değil biçimle anlatılır.
- Diskin içi ince damar çizgileriyle dolu, sürüklerken canlı döner; açı ortada mono ("30°"); yakalandığında altındaki çentik kobalt yanar.
- Yanındaki plaka önizlemesi (T196) aynı anda döner: kullanıcı kadranı değil plakayı izleyerek ayarlar.
- T115 ve T116 kabul ölçütleri güncellendi.

### 4.4 3D önizleme (M6)
- "Stüdyo" görünümü: token'lardan yumuşak dikey gradyan zemin (asla saf siyah/beyaz), uzaklaştıkça kaybolan yer ızgarası, plakanın altında temas gölgesi, mat ve hafif soluk malzemeler, parçalarda ince kenar çizgisi (teknik çizim hissi). Parlak "oyun" görünümü yok.
- Sağ üstte **görünüm küpü** (Onshape/Fusion alışkanlığı); ilk açılışta üstten izometriğe yumuşak geçiş. Bu, sahibin "havalı" dediği an.
- 2D ile aynı renk dili: takım ve boşta hareket `sim-tool` / `sim-rapid`; tuval araç çubuğunda 2D/3D geçişi; aynı `WorkspaceLayout`.
- Ana sayfa proje kartlarında 3D küçük görsel (T160 PNG) M8'de kimliğin en güçlü vitrini olur (T180'e eklendi).
- T152 ve T154 kabul ölçütleri güncellendi.

## 5. Backlog değişiklikleri (bu PR)

Yeni **M2.5** (B5'ten önce), 7 küçük görev, 2 batch:

| Batch | Görev | Konu |
| --- | --- | --- |
| B4a | T194 | Marka: işaret, yazı markası, favicon, kabukta yerleşim |
| B4a | T194a | Kabuk/Ana sayfa sadeleştirme, alan ikonları, "export" → "dışa aktarma" |
| B4a | T195 | Tipografi: mono sayılar, başlık ölçeği, `Measure`, kompakt yoğunluk token'ı |
| B4b | T196 | Tuval görsel dili v1 (dizilim, simülasyon, plaka önizleme) |
| B4b | T197 | Dizilim + Simülasyon için çalışma alanı düzeni (masaüstü) |
| B4b | T198 | Telefon/tablet: önce tuval |
| B4b | T199 | Uyarı hiyerarşisi |

Kabul ölçütü güncellenen planlı görevler (silinen yok): T115, T116 (kadran görünümü), T118 (kompakt satır, tek "Bant" hücresi), T124, T130 (çalışma alanı + kompakt denetçi), T152, T154 (stüdyo görünümü, görünüm küpü), T171, T180, T183, T188 (T196–T198 ile çakışmayı önleyen notlar). Özet tablosu: 94 → 101 görev, 31 → 33 batch.

Not: M2 görevleri (T100–T111) backlog'da hâlâ `todo` görünüyor; PO'nun `done` yapması gerekir (bu PR'da dokunulmadı).

## 6. Sahibe sorular (karar gerekli)

- **FQ1 Logo yönü**: (A) önerilen "toolpath N" monogramı + yazı markasını ekip kod içinde SVG olarak çizsin (öneri), yoksa (B) siz bir tasarımcıdan logo mu getireceksiniz (o zaman T194 yer tutucuyla ilerler)?
- **FQ2 Sol üst köşe**: NittCam logosu sol üste, "Atölyem / Operatör" kutusu kenar çubuğunun altına insin mi? (öneri: evet)
- **FQ3 Dışa aktar adımındaki "profil doğrulanmadı" bloğu**: kırmızıdan (tehlike) sarıya (uyarı) çekilsin mi? Onay kutusu ve metin aynen kalır. Güvenlik iletişimi olduğu için sizin kararınız. (öneri: evet; kırmızı yalnızca gerçekten engelleyen kontrol hataları için)
- **FQ4 Menüden "Oluştur" kalksın mı?** Spec menüsünde var; bugün "Yeni proje" ile aynı yere gidiyor. (öneri: kalksın; M11'de AI sohbet gelince "Oluştur" o anlamla geri döner)
- **FQ5 3D'yi öne çekmek ister misiniz?** "Havalı" etki M6'ya kadar gelmeyecek. Seçenek: M3'ten sonra yalnızca T152 (3D temel, tek plaka) öne alınır; bedeli çizim tahtasının ~1 batch gecikmesi. (öneri: sıra kalsın; M2.5 tuval dili ve logo ile görsel sıçrama zaten gelir)
- **FQ6 Varsayılan tema**: bugün "sistem". Atölye ekranları için varsayılan koyu mu olsun? (öneri: sistem kalsın; koyu tuval kontrastı T196'da düzeliyor)

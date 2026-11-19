# Fable tasarım incelemesi #3 (2026-11-19)

Kapsam: main `a46b8e5` (B10, B10a, M3 B5–B7 sonrası). Önceki incelemeler: `2026-11-18-fable-design-review-1.md`, `2026-11-18-fable-design-review-2.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla çalıştırıldı (e2e ile aynı kurulum). Playwright ile 1440 × 900 ve 390 × 844'te, açık ve koyu temada şu akışlar gezildi: Ana sayfa, Projeler, Makineler + form, sihirbaz 1–5 (5 satır yapıştırma, XLSX içe aktarma, satır menüsü, damar açılır kutusu, çoklu seçim, toplu düzenleme, hatalı satır), çizim tahtası (dikdörtgen ve çizgi çizimi sürerken, parça seçiliyken), Dizilim (0° ve 30° damar), Simülasyon, Dışa aktar. 107 görüntü alındı; 25'i `2026-11-19-fable-3/` klasöründe. Ürün koduna dokunulmadı; e2e paketi çalıştırılmadı.

Sınırlar: 768 ve 1024 px bakılmadı. Telefonda dokunarak çizim ve sürükleme denenmedi (yalnızca görüntü). Gezinti sırasında konsol hatası veya sayfa hatası görülmedi.

## Puanlar

| Başlık | #1 | #2 | #3 | Not |
| --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 5 | 6,5 | 7 | Tahta ve kesim listesi "mühendislik aleti" gibi duruyor. Kabuk hâlâ standart; tuvalde malzeme sıcaklığı yok; dışa aktar adımı en zayıf ekran |
| Modernlik | 7 | 7,5 | 8 | Araç durumu dili (dolu ray düğmesi, kesikli önizleme, imleçte mono değer çipi) güncel CAD seviyesinde; damar kadranı özgün |
| Kullanılabilirlik | 6,5 | 7 | 7,5 | Masaüstü akışı rahat. Telefonda kesim listesi ve simülasyon geride; 1. adımda kadran ekranın altında kalıyor |
| M4–M6 için hazır olma | 6 | 7 | 7,5 | Tuval bütçesi tutuyor (tahta 654 × 664, Dizilim 654 × 701). Denetçi iki ayrı kalıpta; T130 öncesi tekleşmeli |

Sahibin "beyaz zemin, turuncumsu düğme olmasın" isteği karşılanmış durumda: turuncu yalnızca simülasyonda takım ve boşta hareket rengi. Kalan fark "klas" tarafında: ekran artık demode değil, ama CNC ürünü olduğu tuvale kadar anlaşılmıyor ve tuvaldeki plaka gri, parçalar düz mavi.

## İyi olanlar (koruyun)

- **Kesim listesi tablosu** (`cutlist-grid-1440-light.png`, `-dark.png`): 36 px satır, mono sayılar, "Sorun yok" çipi, alt satırda "5 satır · 30 parça · 9,82 m² · ≈ 2 plaka". Excel'e gerek bırakmıyor. Satır menüsü kısayolları gösteriyor.
- **Çizim sürerken tahta** (`board-drawing-1440-light.png`): kesikli önizleme, imleçte "Uzunluk 652,6 ; Açı 282,4°" çipi, durum çubuğunda tek satır ipucu. D-039 tam uygulanmış.
- **Tuval bütçesi**: tahta 1440'ta 654 × 664 px (hedef ≥ 640 × 660), telefonda 548 px yükseklik (%65). İnceleme #2'nin 1. ve 2. bulgusu kapandı.
- **Damar** (`dizilim-grain30-1440-light.png`): plaka taraması 30° dönüyor, kilitli parçalarda yön işareti var, hücrede "↔ 0°". Serbest açı uçtan uca görünür.
- **Toplu düzenleme** (`cutlist-bulk-edit-1440-light.png`): "boş bırakılan alan değişmez" kuralı açık, yan sayfa sakin.
- **Simülasyon** (`simulation-1440-light.png`): "Oynat" dolu vurgu rengi, özet tek liste, derinlik şeridi ve G-code satırı eşleşiyor. İnceleme #2'nin 7. bulgusu kapandı.

## Sorunlar (önem sırasıyla)

1. **Telefonda kesim listesi kart değil, form yığını** (`cutlist-cards-390-light.png`, `cutlist-selection-390-dark.png`). Bir kart 158 px; ekrana 2,5 satır sığıyor, 30 satırlık liste yaklaşık 4.700 px kaydırma demek. Düğmeler iki satıra, seçim varken dört satıra dağılıyor ve liste 330. pikselde başlıyor. "Bant ☐ –" hücresi ne olduğu anlaşılmadan duruyor. B8'de T123 aynı şeride arama, sıralama ve filtre ekleyecek; önce şerit toparlanmalı. → T248
2. **Dizilim panelleri hâlâ iki dilde konuşuyor** (`dizilim-grain30-1440-light.png`, `dizilim-selected-1440-dark.png`).
   - Plaka sekmeleri bir satırda, ızgara/yakınlaştırma araçları altında ayrı satırda. T244 "aynı satır" demişti; 1440'ta gerçekleşmemiş.
   - Izgara burada onay kutusu + "Milimetre ızgarası (100 mm)" yazısı; tahtada aynı iş simge düğmesi.
   - Sağ denetçide değerler kırılıyor: "596 × 716 / mm", "X 622 · Y / 742 mm", "Damar yönü / kilitli". Tahtanın denetçisi aynı bilgiyi tek satırda mono veriyor. İki ayrı kalıp var.
   - Sol panelde "Boşluk 8 mm · Kenar 10 mm" çipleri hemen üstlerindeki iki giriş alanını tekrar ediyor; "Plaka 1: 13 parça, fire %18" satırları sekmeleri tekrar ediyor.
   - "Şimdilik üç mod da en az fireye göre diziyor; süre ve takım değişimi ölçüldükçe ayrışacak." ve "Artık parça kullanımı (yakında)" geliştirici notu; müşteri ekranında durmamalı. → T249
3. **Telefonda simülasyon denetimleri düğme şeridinin arkasında** (`simulation-390-light.png`). Zaman çubuğu "Ayarlar / G-code" şeridine yapışık; hız seçimi ve konum satırı şeridin arkasında kalıyor, aradan uçları görünüyor. İnceleme #2'de tahtada düzelen sorunun aynısı. Başlık da sığmıyor: "Önizleme / simülasy…". → T249
4. **Dışa aktar adımı ürünün son sözü ama en özensiz ekran** (`export-1440-light.png`, `export-390-dark.png`).
   - "İndir" 1440 × 900'de ekranın altında, sabit alt çubuğun arkasında. Son adımda alt çubuğun sağı boş; ana eylem orada olmalı.
   - Dosya satırları kırılıyor: "sha256 2 / f2acd1f01c0", telefonda "s / ha256". İnceleme #1'in 5. bulgusunda yazılmıştı, duruyor.
   - Boyut "20060 bayt"; diğer her yerde Türkçe sayı biçimi var. → T250
5. **Tuvalde malzeme hissi yok** (bütün tuval görüntüleri). Plaka gri, parçalar aynı açık mavi; tahta, Dizilim ve Ana sayfa küçük görseli birbirinin aynısı mavi kutular. İnceleme #1 §4.1 "tuvalde sıcak, soluk ahşap tonu" demişti; uygulanmadı. Kurumsal imaj puanını en çok bu tutuyor ve M6'daki 3D malzemeleri aynı aileden gelecek. → T251
6. **1. adımda damar kadranı önizlemeden kopuk** (`wizard-machine-1440-light.png`, `wizard-machine-390-light.png`). 1440 × 900'de kadran ekranın altında, alt çubuğun arkasında başlıyor; döndürdüğü plaka sağ üstte. Telefonda arada "Uyarılar" kartı var, kadran ile plaka arası yaklaşık 400 px. Kadran ürünün imzası; kaydırmadan görünmeli ve plakanın yanında durmalı. Boş "Uyarılar: Sorun bulunmadı" kartı bu adımda hâlâ tam kart (T246 yalnızca kesim listesinde çipe indirdi). → T252 (T121 aynı ekranı değiştiriyor, onunla)
7. **Tabloda sıfır kalabalığı ve kayan düzen** (`cutlist-grid-1440-light.png`, `cutlist-issue-1440-light.png`). Bant kullanmayan projede 5 satırda 20 adet "0" var; gözü ölçülerden çekiyor. Bir hata çıkınca "Uyarılar" paneli solda açılıyor, tablo 290 px sağa kayıyor ve dört bant sütunu tek "Bant" sütununa dönüyor: kullanıcı yazarken tablo biçim değiştiriyor. → T253 (T123 ile)
8. **Tahtada plaka çerçevesi masaüstünde çerçeve gibi görünmüyor** (`board-1440-light.png`, karşılaştırma: `board-390-light.png`). Sığdırma parçaları çerçevelediği için plakanın üst ve sağ kenarı ekran dışında; görünen iki kesikli çizgi eksen sanılıyor, "Plaka 2.800 × 2.070" etiketi cetvelin altında kalıyor. Telefonda plaka tam görünüyor ve ölçek hemen anlaşılıyor. Ayrıca tahtada damar işareti yok (Dizilim'de var) ve çizim sırasında tuval odak çizgisi yalnızca sağ ve alt kenarda beliriyor (`board-drawing-1440-light.png`). → T254 (T130 ile)
9. **İçe aktarma panelinde ana düğme ekranın altında** (`cutlist-import-1440-light.png`, `cutlist-import-390-light.png`). 5 satırlık bir yapıştırmada bile "5 satır ekle" düğmesine kaydırmak gerekiyor; açıklama paragrafı üç cümle. Akış çalışıyor, bu yüzden ayrı görev açılmadı: T248'e tek madde olarak eklendi (uygula/vazgeç satırı panelin altına yapışık).
10. **Kabuk tekrarları sürüyor** (bütün ekranlar): "Kaydedildi" iki yerde, "Oluştur" menüde, "Proje adı" küçük başlığı. T247 zaten B8 ile gelecek; yeni görev yok.

## Karar verildi (sahibi isterse değiştirir)

Tasarım kararları incelemeciye devredildiği için aşağıdakiler soru olarak bırakılmadı:

- **K1 Tuval malzeme tonu:** plaka ve parçalar sıcak, soluk ahşap ailesinden; arayüzün vurgu rengi kobalt kalır, seçim ve araç rengi kobalt kalır. İkinci arayüz rengi eklenmez (D-040).
- **K2 Son adımda ana eylem alt çubukta:** 5. adımda "İleri"nin yerinde "İndir" durur. Güvenlik onay kutuları ve cümleleri aynen kalır; düğme onaylar tamamlanana kadar pasif.
- **K3 Adım adı:** spec §3.7 "Önizleme / simülasyon" diyor; ad değişmedi. Yalnızca 640 px altında başlıkta kısa etiket "Simülasyon" gösterilir. Adın tamamen "Simülasyon" olması spec değişikliği ister.
- **K4 Tahtada sığdırma:** plaka çerçevesi açıkken sığdırma plakayı ve parçaları birlikte çerçeveler (T243'teki "yalnızca parçalar" kuralının yerine).
- **K5 Bant değeri 0 ise hücrede "–"** gösterilir (soluk); yazılınca değer görünür. Veri değişmez.
- **K6 Tek denetçi kalıbı:** bütün tuval ekranlarında sağ panel "etiket solda, mono değer sağda, tek satır" satırlarından oluşur (D-040).

## Çıktılar

- Kural: `docs/DECISIONS.md` D-040 (tuval malzeme tonu, tek denetçi satırı, son adımda ana eylem alt çubukta).
- `docs/BACKLOG.md`: yeni **B8a** = T248–T251 (B8'den hemen sonra); T252 ve T253 B8'e, T254 B11'e eklenir. Başka partinin sırası değişmedi. Özet: 110 → 117 görev, 34 → 35 parti.

| Görev | Konu | Nerede |
| --- | --- | --- |
| T248 | Telefonda kesim listesi: sıkı kartlar, tek satır araç şeridi, içe aktarmada yapışık uygula satırı | B8a |
| T249 | Dizilim ve Simülasyon panelleri: tek araç satırı, ortak denetçi satırı, tekrar ve geliştirici notu yok, telefonda oynatma denetimleri görünür | B8a |
| T250 | Dışa aktar: "İndir" alt çubukta, dosya satırları düzgün | B8a |
| T251 | Tuval malzeme tonu (plaka ve parçalar) | B8a |
| T252 | 1. adım: kadran önizlemenin yanında, boş uyarı kartı çipe iner | B8 ile (T121) |
| T253 | Tablo: sıfırlar soluk, uyarı paneli tabloyu kaydırmaz | B8 ile (T123) |
| T254 | Tahta: plakaya sığdırma, damar işareti, odak çizgisi | B11 ile (T130) |

## Görüntüler

Klasör: `docs/reviews/2026-11-19-fable-3/` (25 dosya, 1440 × 900 ve 390 × 844).

| Ekran | Dosyalar |
| --- | --- |
| Ana sayfa, Projeler, Makine formu | `home-1440-light.png`, `projects-1440-dark.png`, `machine-form-1440-light.png` |
| 1. adım | `wizard-machine-1440-light.png`, `wizard-machine-390-light.png` (tam sayfa) |
| Kesim listesi | `cutlist-grid-1440-light.png`, `cutlist-grid-1440-dark.png`, `cutlist-cards-390-light.png`, `cutlist-selection-390-dark.png`, `cutlist-issue-1440-light.png`, `cutlist-grain-popover-1440-light.png`, `cutlist-bulk-edit-1440-light.png`, `cutlist-import-1440-light.png`, `cutlist-import-390-light.png` |
| Çizim tahtası | `board-1440-light.png`, `board-drawing-1440-light.png`, `board-selected-1440-dark.png`, `board-390-light.png` |
| Dizilim | `dizilim-grain30-1440-light.png`, `dizilim-selected-1440-dark.png`, `dizilim-390-light.png` |
| Simülasyon | `simulation-1440-light.png`, `simulation-390-light.png` |
| Dışa aktar | `export-1440-light.png`, `export-390-dark.png` (ikisi de tam sayfa; ortadaki şerit sabit alt çubuk) |

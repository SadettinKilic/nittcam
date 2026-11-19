# CTO tasarım incelemesi #4 (2026-11-19)

Kapsam: main `988b5b0` (B8a ve B8 sonrası). Önceki incelemeler: `2026-11-18-fable-design-review-1.md`, `2026-11-18-fable-design-review-2.md`, `2026-11-19-fable-design-review-3.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla 3210 portunda çalıştırıldı (inceleme #3 ile aynı kurulum). Playwright ile 1440 × 900'de (açık ve koyu), 1024 × 768'de ve duman testi olarak 390 × 844'te şu akışlar gezildi: Ana sayfa, Ayarlar → Malzemeler (ekle, düzenle), sihirbaz 1. adım (kütüphaneden malzeme), Parçalar ("Dolap ekle", elle satır, grupla, ara, sırala), çizim tahtası, Dizilim, Simülasyon, Dışa aktar. Tuval ölçüleri 1280 × 800'de de ölçüldü. 20 görüntü `2026-11-19-cto-4/` klasöründe. Ürün koduna dokunulmadı; e2e paketi çalıştırılmadı.

Yeni kurallar uygulandı: D-043 (önce masaüstü; telefon yalnızca "kırılıyor mu" kontrolü, telefon cilası "Mobile UI pass" bölümüne) ve D-042 (inceleme iki partide bir).

Sınırlar: operatör gezintisini bir insan değil betik yaptı; tık ve alan sayıları gerçek, süre tahmindir. Gezinti sırasında konsol hatası veya sayfa hatası görülmedi.

## Puanlar

| Başlık | #1 | #2 | #3 | #4 | Not |
| --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 5 | 6,5 | 7 | 7,5 | Tuvalde ahşap tonu ürünü ilk bakışta "CNC işi" yaptı; Dışa aktar toparlandı. Puanı tutan: kullanıcıya sızan İngilizce satır ve iç kod, kesilen çipler, kırpılan seçim kutusu |
| Modernlik | 7 | 7,5 | 8 | 8 | Dolap üreticisinin canlı önizlemesi ve tek denetçi satırı güncel. Yeni bir sıçrama yok, gerileme de yok |
| Kullanılabilirlik | 6,5 | 7 | 7,5 | 7,5 | İyi yol çok kısa (19 tık, 5 alan). Ama en doğal seçim (Melamin 18) 4. adımda duvara çarpıyor ve üretici 8 mm arkalığı 18 mm listeye koyuyor; bu ikisi düzelince 8,5 |
| M4–M6 için hazır olma | 6 | 7 | 7,5 | 8 | Tek denetçi kalıbı ve ahşap belirteçleri yerinde; 3D malzemeleri aynı aileden gelebilir. Risk: 1280 ve 1024'te tuval küçük |

Sahibin "beyaz zemin, turuncu düğme olmasın" isteği karşılanmaya devam ediyor. "Kullanım kolaylığı ana hedef" isteği iyi yolda karşılanıyor, varsayılan yolda henüz değil: yeni kurulumda dört hazır malzemeden yalnızca biri (MDF 18) G-code'a kadar gidiyor.

## Kullanım kolaylığı gezintisi (yeni)

İş: atölye operatörü olarak 600 × 720 × 560 mutfak alt dolabı + 2 raf (dolap üreticisiyle), elle bir ek parça (Baza 564 × 100), diz, simüle et, G-code indir.

### Sonuç (iyi yol: MDF 18 mm)

| Ölçü | Değer |
| --- | --- |
| Ekran | 5 adım + 1 pencere (Ana sayfa → 1. adım → Parçalar + "Dolap ekle" → Dizilim → Simülasyon → Dışa aktar) |
| Tık | 19 (zorunlu en az 17: proje adına tıklamak ve "Oynat" isteğe bağlı) |
| Yazılan değer | 5 (proje adı, raf sayısı, "Baza", 564, 100) |
| Betik süresi | 12,9 sn (bekleme dahil; simülasyon 0,2 sn'de hazır) |
| Tahmini operatör süresi | uygulamayı bilen biri için 1,5–2 dk; ilk kez kullanan için 3–4 dk (güvenlik listesini okuyarak). Tahmindir, insanla ölçülmedi |
| Çıktı | `Mutfak_alt_dolap_60_S1.tap`, 14,0 KB, bütün kontroller geçti, 1 plaka, fire %49,3 |

Tıkların dağılımı: Yeni proje 1 · proje adı 1 · malzeme 2 · İleri 4 · Dolap ekle 3 (aç, raf alanı, "8 parça ekle") · Satır ekle 1 · Diz 1 · Oynat 1 · güvenlik onayı 4 · İndir 1.

### Duraksama noktaları (akış sırasıyla)

1. **Malzeme listesinde "MDF" iki kez var** (`wizard-step1-library-1440-light.png`): üstte kütüphanedeki "MDF 18 mm", altta "Ahşap" başlığında yalın "MDF". Yeni proje yalın olanla açılıyor; kütüphane girişini seçmek için neden olmadığı belli olmayan ikinci bir seçim gerekiyor. Seçilince kapalı kutuda "18 mm" satırı alt kenarda kırpılıyor.
2. **En doğal seçim çıkmaz sokak** (`wizard-step1-no-params-1440-light.png`, `simulation-blocked-1440-light.png`). Mutfak dolabı için "Melamin 18 mm" seçilince 1. adımda kırmızı kutu çıkıyor ama "İleri" çalışıyor; parçalar giriliyor, dizilim yapılıyor, ancak 4. adımda "Bu dosya indirilemez" deniyor. Çözüm için projeden çıkıp on bölümlü makine formunda "Malzeme parametreleri"ni bulmak gerekiyor; hata metni ise "Makineler → Malzemeler" diyor (Malzemeler artık Ayarlar'da bir sayfa). Hazır dört malzemeden üçü (Akrilik, Kontrplak, Melamin) örnek makinede böyle. Gezintide MDF'ye dönüldü; dönmeyen operatör için iş burada biter.
3. **Dolap üreticisi iyi, bir üretim hatası taşıyor** (`cabinet-dialog-1440-light.png`). Varsayılanlar tam bu iş (600 × 720 × 560); yalnızca raf sayısı değişti, canlı önizleme ve parça listesi güven veriyor. Ama "Arkalık kalınlığı 8 mm" olan arkalık, 18 mm'lik kesim listesine notsuz düşüyor ve 18 mm plakaya diziliyor (Dizilim'de "5.1 Arkalık"). Operatör fark etmezse yanlış kalınlıkta parça kesilir.
4. **Ekleme sonrası iki örtme** (`cutlist-after-cabinet-1440-light.png`). "Dolap 1: 6 satır eklendi" bildirimi "İleri" düğmesini 3,6 sn kapattı (ölçüldü); hata varken "Uyarılar" paneli Sağ bant, Not ve Grup sütunlarını ve ilk üç satırın menüsünü örtüyor. İkisi de T256'da yazılı; yeni görev açılmadı, önemi teyit edildi.
5. **Elle satır hızlı, sonunda hayalet satır kalıyor.** "Satır ekle" odağı ad hücresine koyuyor, yazınca varsayılan ad siliniyor, Tab ile En → Boy → Adet akıyor: iyi. Son hücrede Enter'a basınca "Parça 8, 100 × 100" satırı açılıyor ve dokunulmadan kalırsa dizilime girip kesiliyor (ilk denemede plakada "8.1" olarak çıktı).
6. **Dizilim boş açılıyor** (karşılaştırma: `dizilim-1440-light.png`). Tuval "Henüz dizilim yok" diyor; "Diz" sol panelde. Dizmeden "İleri"ye basan kullanıcı Simülasyon'da "Simüle edilecek dizilim yok" ekranına düşüyor ve geri dönüyor. Parça varsa ve dizilim yoksa adımın kendisi dizebilir.
7. **Simülasyondaki G-code indirilecek dosya gibi görünmüyor** (`simulation-1440-light.png`). Panel "Dosya: NittCam_S1.tap", "(PROJE: NittCam)", "(REVIZYON: 0)" gösteriyor; inen dosya `Mutfak_alt_dolap_60_S1.tap`, "(PROJE: Mutfak alt dolap 60)", "(REVIZYON: 3)". Operatörün makinede karşılaştıracağı ilk satırlar tutmuyor.
8. **Dışa aktar açık ve güvenli** (`export-1440-light.png`, `export-done-1440-light.png`). "İndir" alt çubukta, pasifken yanında nedeni yazıyor; dört onay kutusu işaretlenince açılıyor; indirince "Dosya kaydedildi ve indirildi" ve geçmiş satırı geliyor. Dört tıkın ikisi air cut ile ilgili ve örnek profile özgü; güvenlik gereği kısaltılmadı.
9. **MDF'de gereksiz damar kilidi** (`cutlist-grouped-1440-dark.png`). Malzemenin damarı "Yok" iken üretilen satırlar "Damar ☑ 90° / 0°" ile geliyor; dizilim boşuna kısıtlanıyor. Aynı durumda 1. adım önizlemesi de çizgili (kadran "–" gösterirken).

Özet: iyi yol bir CAM aracı için çok kısa ve hiçbir yerde sayı aramak gerekmedi. Kullanım kolaylığını bozan şey tık sayısı değil, **geç çıkan engeller**: sorun 1. adımda doğuyor, 4. adımda durduruyor. Kural olarak D-045 yazıldı.

## İyi olanlar (koruyun)

- **Tuvalde ahşap tonu** (`dizilim-1440-light.png`, `dizilim-1440-dark.png`, `board-1440-light.png`): plaka açık, parçalar bir ton koyu, mürekkep çizgi; kobalt yalnızca seçim ve araçta. İnceleme #3'ün 5. bulgusu kapandı; koyu temada da okunuyor.
- **Dolap üreticisi** (`cabinet-dialog-1440-light.png`): tek pencere, 11 alan, hepsi dolu geliyor; önden görünüm ve parça listesi anında güncelleniyor; "Grup adı yalnızca etiket" notu D-041'i kullanıcıya da söylüyor. Plaka kalınlığı projeden geliyor (16 mm projede 16 açıldı).
- **Kesim listesi düzeni** (`cutlist-grouped-1440-dark.png`): gruplar "Dolap 1 · 6 satır · 8 parça" başlığıyla katlanıyor, sıfırlar soluk "–", arama ve sıralama tek satırda. 1024'te bant dört küçük kenar işaretine iniyor (`cutlist-1024-light.png`), tablo okunaklı kalıyor.
- **Malzeme kütüphanesi** (`materials-1440-light.png`, `material-edit-1440-dark.png`): form kısa, birimler alanın içinde, renk örneği tuvaldeki tonla aynı aileden.
- **Dışa aktar** (`export-1440-light.png`): inceleme #3'ün 4. bulgusu kapandı; dosya satırı tek satır ("14,0 KB · sha256 9eaddf2b…" + kopyala).
- **1. adımda kadran önizlemenin altında** (`wizard-step1-library-1440-light.png`): inceleme #3'ün 6. bulgusu kapandı; boş "Uyarılar" kartı "Sorun yok" çipine indi.

## Sorunlar (önem sırasıyla)

1. **Varsayılan malzemelerin üçü G-code vermiyor ve bu 4. adımda öğreniliyor** (duraksama 2). Ayrıca kullanıcıya İngilizce satır ("Teknik ayrıntı: No cutting parameters for melamine 18 mm on this machine.") ve iç kod ("TOOLPATH" çipi, Dışa aktar) görünüyor. → T257, T258
2. **Dolap üreticisi farklı kalınlıktaki arkalığı aynı listeye koyuyor** (duraksama 3); damarsız malzemede damar kilidi veriyor (duraksama 9); "Tek kapak / Çift kapak" iki satıra kırılıyor, "Arkalık" seçimi "İçte (yanlar…" diye kesiliyor; pencere son kullanılan değerleri hatırlamıyor. → T260
3. **1. adımda malzeme alanı** (duraksama 1): çift "MDF", kırpılan iki satırlı değer, damarsız malzemede çizgili önizleme, kalınlık alanında yerel açılır ok. → T259
4. **Dizüstü genişliklerinde tuval küçük** (`simulation-1024-light.png`). Ölçülen tuval: 1440 × 900'de tahta 654 × 670, Dizilim 654 × 707, Simülasyon 654 × 511; 1280 × 800'de 494 × 509 / 494 × 546 / 494 × 346; 1024 × 768'de 430 × 457 / 430 × 494 / 430 × 250. 1024'te simülasyon tuvali oynatma denetimlerinden kısa. Kenar çubuğu 224 px açık kalıyor ve başlık iki satıra çıkıyor. M4'te tahta en çok burada kullanılacak. → T263
5. **Malzemeler sayfası 1024'te taşıyor** (`materials-1024-light.png`): sayfa 37 px yatay kayıyor, "sil" düğmesi ekran dışında; kesim ayarı çipi 1440'ta "…5 mm için ayar y…", 1024'te "Örnek router (Mach3): …" diye kesiliyor, yani durumun kendisi okunmuyor. → T257 (çip metni), T263 (taşma)
6. **Hayalet satır ve boş açılan Dizilim** (duraksama 5 ve 6). → T261
7. **Simülasyondaki G-code başlığı inen dosyayla tutmuyor** (duraksama 7). → T262
8. **Bildirim "İleri"yi, "Uyarılar" paneli sütunları örtüyor** (duraksama 4). T256'da yazılı (B11 ile). Yeni görev yok; B11'de atlanmamalı.
9. **Tahtada plaka çerçevesi hâlâ kesik** (`board-1440-light.png`): üst kenar ve etiket cetvelin altında. T254'te yazılı (B11 ile). Yeni görev yok.
10. **Dışa aktar'da sol sütun boş, sağ sütun uzun** (`export-done-1440-light.png`): geçmiş tablosu ekranın altında kalıyor. Akış çalışıyor; T176 (Dışa aktar adımı: bütün biçimler, kayıtlar, geçmiş) bu ekranı yeniden kuracağı için görev açılmadı, T176'ya not olarak bırakıldı.

Telefon (390 × 844) duman testi: ana sayfa, Malzemeler, 1–5. adımlar ve dolap penceresinde sayfa düzeyinde yatay kayma yok; "İleri" / "İndir" her adımda erişilebilir. Görülen telefon kusurları (dolap penceresinde "Çift kapak" etiketi "Kapak boşluğu" alanının altına giriyor, `cabinet-dialog-390-light.png`; simülasyonda oynatma denetimleri düğme şeridinin arkasında, `simulation-390-light.png`, zaten T255) D-043 gereği görev yapılmadı, `docs/BACKLOG.md` "Mobile UI pass" bölümüne not olarak eklendi.

## Karar verildi (sahibi isterse değiştirir)

- **K1 Örnek makineye hazır ayar:** örnek makine profiline Melamin 18 ve Kontrplak 18 için MDF 18 ile aynı kesim ayarı eklenir. Profil "Taslak / Örnek" ve doğrulanmamış kalır, dosyanın ilk satırındaki uyarı aynen durur. Akrilik 5 ayarsız kalır (plastik için ayrı değer gerekir) ve listede "ayar yok" işaretiyle görünür. Sahibi gerçek değerleri kendi makinesinde girecek.
- **K2 Farklı kalınlıktaki arkalık listeye kendiliğinden girmez:** üretici onu özet satırında "8 mm · ayrı plaka" diye gösterir; kullanıcı isterse işaretleyip ekler. Proje başına tek plaka kalınlığı kuralı değişmedi (çoklu stok M7'de, T164).
- **K3 Dizilim ilk girişte kendisi dizer:** parça var ve dizilim yoksa bir kez. Var olan dizilime ve kilitli parçalara giriş dokunmaz.
- **K4 Enter ile açılıp hiç dokunulmayan satır silinir;** "Satır ekle" ile açılan satır kalır.
- **K5 1440'ın altında çalışma adımlarında kenar çubuğu simge şeridi olarak açılır;** kullanıcının kendi tercihi hatırlanır ve önceliklidir.
- **K6 Dışa aktar'daki dört onay aynen kalır.** İkisi air cut hakkında ve tekrar gibi duruyor, ama doğrulanmamış profilde bilinçli bir güvenlik kapısı; tık saymak için kısaltılmaz.
- **K7 Genel malzeme türleri seçilebilir kalır,** listenin altında "Kütüphane dışı" başlığıyla; yeni proje kütüphanenin makinede ayarı olan ilk girişiyle açılır.
- **K8 Gezinti her incelemede tekrarlanır:** aynı iş, aynı sayım. Taban: 19 tık, 5 yazılan değer, 5 ekran.

## Çıktılar

- Kural: `docs/DECISIONS.md` **D-045** (geç çıkan engel olmaz; hazır gelen her şey birlikte çalışır; kullanıcıya İngilizce ve iç kod görünmez; üretici stoğa uymayan parçayı sessizce eklemez; her incelemede operatör gezintisi).
- `docs/BACKLOG.md`: yeni **B11a** = T257–T260 (B11'den hemen sonra, B12'den önce); T261 B12'ye, T262 ve T263 B13'e eklenir. Başka partinin sırası değişmedi. "Mobile UI pass" bölümüne üç not eklendi. Özet: 117 → 124 görev, 35 → 36 parti (T255 ve T256 bu sayımın dışında).

| Görev | Konu | Nerede |
| --- | --- | --- |
| T257 | Hazır malzemeler kutudan çıktığı gibi kesiyor; listede "ayar yok" işareti; Malzemeler çipi kısa ve okunur | B11a |
| T258 | "Kesim ayarı yok" 1. adımda yakalanır: "Kesim ayarı ekle" düğmesi, adım göstergesinde hata işareti, İngilizce satır ve iç kod yok | B11a |
| T259 | 1. adım malzeme alanı ve önizleme: tek satır değer, tek "MDF", damarsız malzemede çizgisiz önizleme | B11a |
| T260 | Dolap üreticisi: farklı kalınlıktaki arkalık listeye girmez, damarsız malzemede damar kilidi yok, son değerler hatırlanır, etiketler kırılmaz | B11a |
| T261 | Parçalar → Dizilim: hayalet satır yok, ilk girişte dizilim kendisi çalışır | B12 ile (T135) |
| T262 | Simülasyondaki G-code başlığı inen dosyayla aynı | B13 ile (T137) |
| T263 | 1280 ve 1024'te tuval bütçesi (kenar çubuğu simge şeridi), Malzemeler 1024'te taşmaz | B13 ile (T137) |

Her görev en çok yarım gün. Zaten yazılı olup bu incelemede teyit edilenler: T254 ve T256 (ikisi de B11 ile).

## Görüntüler

Klasör: `docs/reviews/2026-11-19-cto-4/` (20 dosya; 1440 × 900, 1024 × 768 ve 390 × 844).

| Ekran | Dosyalar |
| --- | --- |
| Ana sayfa | `home-1440-light.png` |
| Ayarlar → Malzemeler | `materials-1440-light.png`, `material-edit-1440-dark.png`, `materials-1024-light.png` |
| 1. adım | `wizard-step1-library-1440-light.png`, `wizard-step1-no-params-1440-light.png` |
| Parçalar | `cabinet-dialog-1440-light.png`, `cutlist-after-cabinet-1440-light.png`, `cutlist-grouped-1440-dark.png`, `cutlist-1024-light.png`, `cabinet-dialog-390-light.png` |
| Çizim tahtası | `board-1440-light.png` |
| Dizilim | `dizilim-1440-light.png`, `dizilim-1440-dark.png` |
| Simülasyon | `simulation-1440-light.png`, `simulation-1024-light.png`, `simulation-blocked-1440-light.png`, `simulation-390-light.png` |
| Dışa aktar | `export-1440-light.png`, `export-done-1440-light.png` |

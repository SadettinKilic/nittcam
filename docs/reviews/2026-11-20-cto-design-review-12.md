# CTO tasarım ve ürün incelemesi #12 (2026-11-20)

Kapsam: main `e2e67ca`. #11'den beri gelenler: B36 (T289 makine arşivi, T291 artık parça stoğu, T292 başka kalınlıktaki parçalar yeni projeye), B38 (T181 bakım kaydı + kontrolcü kütüphanesi, T182 Ayarlar Genel / varsayılanlar / logo / DXF katmanları, T183 Görünüm), B37 (T176 dışa aktar adımı: bütün türler + zip, T177 rapor kartı, T179 durum akışı + yeniden üret), B39 (T180 Ana sayfa gerçek veri, cila grubu P4, pencere yüksekliği), B40 (T293 köprü alt sınırları, T294 kesim ayarları açıklığı). B41 (T295 tek ad kalıbı, T296 eski revizyon rozeti, T297 sunucuda NC kontrol listesi) main'de değil; `integration/18` içinde bekliyor. Önceki inceleme: `2026-11-20-cto-design-review-11.md`.

Yöntem #11 ile aynı: üretim derlemesi, boş PGlite, port 3210, Playwright ile 1440 × 900 açık / koyu, üç operatör gezintisi (D-045), 390 px yalnızca duman testi (D-043). Bu turda beş odak vardı:

1. #11'in A (T293) ve E1 (T294) bulgularının, T176 / T179 maddelerinin doğrulanması; güvensiz dosya üretme denemesi (küçük köprü, Ayarlar varsayılanlarından tuhaf değer, eski / elle düzenlenmiş proje).
2. Üç gezinti.
3. M8 çıkış kontrolü.
4. Saha testine hazırlık listesi.
5. Kısa eksik avı: Ayarlar, Makineler, Projeler, Ana sayfa, Dışa aktar.

83 görüntü `2026-11-20-cto-12/` klasöründe. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (en çok 3 "şimdi düzelt"), D-045, D-043.

Sınırlar: tıklar betikte gerçek olay sayımıdır (`isTrusted`); dosya seçimi tıksız yapıldığı için elle +1 eklendi. "Eski proje" denemesi, proje JSON'u `POST /api/projects/:id/copy` ile değiştirilerek yapıldı (veritabanında gerçekten eski bir kayıt yoktu). Denenmeyenler: gerçek yazıcıda etiket baskısı, logo yükleme, kontrolcü kütüphanesinden yeni makine kaydı (form açıldı, kaydedilmedi), 50+ projede sayfalama, sunucu kesintisi (T187), 1024 px, dokunmatik, "Yeniden üret"in eski revizyonu bugünkü kontrollerle reddetmesi (kod yorumu 422 diyor, denenmedi). Konsolda hata ya da uyarı görülmedi. axe (ciddi / kritik): Ana sayfa, Projeler, Makineler, Ayarlar (dört sekme), Şablonlar, Simülasyon, Dışa aktar açık; Ayarlar ve Makineler koyu; Ana sayfa, Projeler, Makineler, Ayarlar, Dışa aktar 390 px: hepsi temiz.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | #8 | #9 | #10 | #11 | #12 | Not |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | 7,5 | 8 | 8 | 8,5 | **8,5** | Ayarlar, Makineler, Ana sayfa ve Dışa aktar derli toplu, açık / koyu tutarlı. Puanı tutan: şirket adı ve logo kaydediliyor ama hiçbir yerde görünmüyor (E2), Projeler satırları, montaj kamerası |
| Modernlik | 8 | 8 | 8 | 8 | 8 | 8,5 | 9 | 9 | 9 | **9** | Değişmedi |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | 8,5 | 8,5 | 8,5 | 8,5 | **8,5** | T293 / T294 kapandı, dışa aktar adımı tamamlandı, gezintiler aynı sayıda. Puanı tutan: kilitli Simülasyon görünümü kaymıyor (B), sınır dışı değerde alan sınırı söylemiyor (Ayarlar, artık parça), kontrol listesi katın altında |
| M4–M7 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | 9 | 9 | 9 | 9 | **9** | Gerileme yok |
| Saha testine hazır olma | – | – | – | – | – | – | – | 7 | 7,5 | **8** | Bütün çıktı türleri sunucudan ve geçmişte, zip, durum akışı, makine arşivi, bakım kaydı, köprü sınırları geldi. Eksik: ince tabaka alt sınırı (A), B41, yardım / örnek proje / saha kiti (M9) |

Özet: #11'in A ve E1 bulguları doğru kapanmış; köprü yoluyla güvensiz dosya üretmek arayüzden de API'den de mümkün değil. Aynı açığın **öbür kolu açık**: "ince tabaka" kalınlığında alt sınır yok, 0,001 mm tabakayla küçük parçalı iş bütün kontrollerden geçip iniyor. Bu turdan **2 "şimdi düzelt"**, **3 yeni görev adayı**, **mevcut görevlere 3 kabul maddesi** ve **14 cila** maddesi çıktı. **M8 bugün kapatılamaz; üç küçük işle kapanır** (aşağıda).

## #11 bulgularının doğrulanması

| Bulgu | Görev | Sonuç | Kanıt |
| --- | --- | --- | --- |
| A. Köprü ölçüsünde alt sınır | T293 | **Kapandı** | Alanlar: genişlik `0,1` ve `2,9` → "En az 3 mm."; yükseklik `0,01`, `0,9`, `17,9` → "1–17 mm arası olmalı."; adet `21`, `2,5` → "1–20 arası tam sayı girin."; proje son geçerli değeri koruyor. Sınır değerler (3 / 1 / 17) kabul. Sunucu: aşağıdaki deneme tablosu (`sim-cutting-tiny-tab-1440-light.png`) |
| A, 3. madde: sığmayan köprü sebebi söylesin, Kesim ayarlarına götürsün | T293 | **Kısmen** | Mesaj doğru: "Küçük parçaya köprü sığmıyor (köprü genişliği ya da sayısı bu parçaya fazla)… Kesim ayarlarında köprüyü küçültün ya da 'Köprü: Kapalı' seçin" + "Kesim ayarlarına git". Bağlantıya basınca sayfa düzeni bozuluyor (**B**) (`sim-tab-width-1000-1440-light.png`, `sim-tab-width-1000-link-1440-light.png`) |
| E1. Gizli durum, açıklık | T294 | **Kapandı** | "Kapalı → Her parçada" sonrası panel durumu yazıyor: "Küçük parçalarda 0,5 mm ince tabaka da açık (1. adımdaki ayar). Kapat". "Adet (parça başına)"; küçük parçada "Küçük parçalarda en az 2 köprü konur (güvenlik kuralı)". Özet'te tek satır + düzenle düğmesi kartı y = 162'ye getiriyor. Kesim yönü altında yönlendirme satırı var (`sim-cutting-roundtrip-1440-light.png`, `sim-cutting-1440-light.png`, `-dark.png`) |
| T176: DXF düğmesi, belgeler geçmişte, zip | T176 | **Kapandı** | "DXF: plaka dizilimi" ve "DXF: parçalar tek tek" ayrı düğme; PDF A4 / A3 "Önizle" + "İndir"; etiket "aç" + "İndir"; altı tür de geçmiş tablosunda "Tür" sütunuyla; 3 plakada "Tümünü indir (.zip)" (3 `.tap` + `OKU.txt`, zip sağlam). Geçmiş kartı 1440 × 900'de ilk ekranda (y = 742) (`export-3sheets-1440-light.png`, `-dark.png`, `export-history-1440-light.png`, `export-3sheets-ready-1440-light.png`) |
| T176: tek ad kalıbı | T295 | **Açık (B41)** | Hâlâ iki kalıp: `Cekmeceli_mutfak_Igsou_S1.tap` ↔ `Cekmeceli-mutfak-Igsou-r1-a4.pdf`, `…-r1-dizilim.dxf`, `…-r1-nc.zip` |
| T179: durum akışı, yeniden üret | T179 | **Kapandı** | Taslak → NC inince "Üretildi" → "Tamamlandı olarak işaretle" → "Üretildi durumuna geri al". "Yeniden üret" penceresi "Rev. 1 NC dosyasını yeniden üret" başlığıyla aynı kontrol listesini ve makine onayını istiyor (`export-status-completed-1440-light.png`, `export-reexport-dialog-1440-light.png`) |
| T179: eski revizyon işareti | T296 | **Açık (B41)** | Tamamlandı projede kesim yönü değiştirildi (Rev. 2): durum "Tamamlandı" kaldı, geçmiş ve Projeler satırı Rev. 1 dosyalarını işaretsiz veriyor (`export-after-edit-1440-light.png`, `projects-1440-light.png`) |
| Sunucuda NC kontrol listesi | T297 | **Açık (B41)** | `POST /api/projects/:id/export { revision, acceptUnverified: true }` kontrol listesi olmadan 201 dönüyor; "Yeniden üret" ucu ise 428 istiyor (D-071). Arayüzden atlanamıyor, yalnız API'den |
| P4 grubu (B39) | P4 | **Çoğu kapandı** | Bildirim adım değişince kapanıyor (Dizilim'de 0 bildirim), boş taslaklar "Son projeler"de yok, artık parça listesi kaynak projeyi yazıyor. **Kapanmayan:** Projeler arama / süzgeç adreste değil; satır yüksekliği arttı (aşağıda) |

## Güvensiz dosya üretme denemesi

Deneme projesi: DXF tabela (3 küçük harf + O'nun iç göbeği, 18 mm MDF, Ø8). "Sunucu" sütunu `GET /export` kuru çalıştırması ve `POST /export` sonucudur.

| Yol | Girilen | Sonuç | Değerlendirme |
| --- | --- | --- | --- |
| Kesim ayarları alanı | genişlik 0,1 / 2,9 · yükseklik 0,01 / 0,9 / 17,9 · adet 21 / 2,5 | reddedildi, alan sınırı söylüyor | Doğru |
| Eski / elle düzenlenmiş proje | `tabs {count 1, width 0.1, height 0.01}` | kayıt 201; kuru çalıştırma `ok: false`; POST **422**; "Köprü bu küçük parçayı tutamayacak kadar küçük (genişlik en az 3 mm, yükseklik 1 mm ile kalınlık − 1 mm arası)" × 4 | Doğru: doğrulayıcı kaynağa bakmadan yakalıyor |
| Aynısı, "yalnız küçük parçada" | `auto: false, width 0.1, height 0.01` | 422 | Doğru |
| Yüksek köprü | `height 17.9` · `width 2.9` | 422 | Doğru |
| Şema dışı | `count 0`, negatif tabaka, `leadIn: "spiral"`, `cutting` yok | kayıt **400** `invalid_project`, alan yoluyla | Doğru |
| Kalınlık sonradan değişir | yükseklik 17, kalınlık 8 | 422 (kesim parametresi yok; 8 mm seti olmadığı için köprü kuralına gelmeden duruyor) | Güvenli |
| Köprü genişliği 1000 | alandan | Simülasyon kilitli, 4 madde, Dışa aktar kırmızı | Güvenli; mesaj doğru, sayfa düzeni **B** |
| Ayarlar varsayılanı | boşluk −5, "abc", 5000 | "Varsayılanları kaydet" pasif | Güvenli; alan sınırı söylemiyor (cila) |
| Ayarlar varsayılanı | boşluk 0, kenar payı 0, "Yok, ince taban bırak", Düz, Geleneksel | kaydedildi; yeni proje bu değerlerle açıldı; Dizilim "Sorun bulunmadı"; Simülasyon **kilitli**: "Kural 6 · Hareket makinenin çalışma alanının dışına çıkıyor: plaka veya parça bu makineye sığmıyor" | Güvenli ama geç ve yanlış adresli (**E1**) (`settings-defaults-zero-1440-light.png`, `layout-gap0-1440-light.png`, `sim-gap0-1440-light.png`) |
| Boşluk 0, kenar payı 10 | Dizilim alanından | kontroller geçti, dosya indi. Dizilim takım çapını boşluğa kendisi ekliyor (parçalar 8 mm arayla), yani parçalar birbirini kesmiyor; 13 parçada "Giriş / çıkış hareketi yer olmadığı için kaldırıldı" uyarısı | Güvenli; uyarı Dizilim'de görünmüyor (cila) (`layout-gap0-margin10-1440-light.png`) |
| **İnce tabaka kalınlığı** | **1. adım alanından `0,001`, `0,01`, `0,05`, `17,99`** | **hepsi kabul; "✓ Tüm kontroller geçti"; Dışa aktar yeşil; dosya indi (`Z-17.9990`)** | **A: şimdi düzelt** (`step1-skin-0_01-1440-light.png`, `sim-skin-0_01-1440-light.png`, `export-skin-0_01-1440-light.png`) |

Sonuç: köprü kolu kapalı. Küçük parçayı tutan ikinci yöntem olan ince tabaka aynı korumayı almamış; #11'in K2 kararı ("her üretim değeri için alt ve üst sınır hem alanda hem doğrulayıcıda") burada uygulanmamış.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

| Ölçü | #7 | #8 | #9 | #10 | #11 | #12 |
| --- | --- | --- | --- | --- | --- | --- |
| Tık | 16 | 16 | 16 | 16 | 16 | **16** |
| Yazılan değer | 5 | 5 | 5 | 5 | 5 | **5** |
| Çıktı | 12,2 KB, 511 satır | aynı | aynı | aynı | `Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, 511 satır | **aynı dosya: 12.463 bayt, 511 satır**, kontroller geçti, 1 plaka, 32 köprü, ≈ 13 dk 2 sn |

- Gerileme yok; açık ve koyu temada aynı bayt sayısı (`cutlist-cabinet-1440-light.png`, `layout-cabinet-1440-light.png`, `sim-cabinet-1440-light.png`, `export-cabinet-1440-light.png`, koyu eşleri).
- İndirince proje "Üretildi" oluyor; "Aç" yine Dışa aktar'da açıyor.
- Yeni: Özet'te "Köprü: her parçada 4 × 10 × 3 mm · Giriş: yay · Yön: climb" satırı var ama 232 px panelde "Köprü: her parçada 4 × 1…" diye kesiliyor; ölçü okunmuyor (cila).
- Kontrol listesi 1 plakalı işte y ≈ 1.200'de; "İndir" için bir ekran aşağı inmek gerekiyor. Tık sayısını değiştirmiyor, kaydırma ekliyor (cila).

## Gezinti 2: menteşeli kapak, 4 kenar bant + hazır şablon → NC

| Ölçü | #8 | #9 | #10 | #11 | #12 |
| --- | --- | --- | --- | --- | --- |
| Tık | 26 | 24 | 24 | 24 | **24** |
| Yazılan değer | 3 | 2 | 2 | 2 | **2** |
| Çıktı | 235 satır | 236 satır | 6,7 KB, 236 satır | `Menteseli_kapak_60_S1.tap`, 6,7 KB, 236 satır | **aynı: 6.828 bayt, 236 satır**, kontroller geçti, T1 → T2, ≈ 2 dk 38 sn |

- Menteşe yuvaları X 22,5 (sol), kulp delikleri X 566 (sağ), şablon kenarı `right`; 6 onay eksiksiz; dosyanın 2. satırı `(SABLON DOGRULANMADI: …)` (`board-door-1440-light.png`, `sim-door-1440-light.png`, `export-door-1440-light.png`, koyu eşleri).

## Gezinti 3: DXF tabela, iç boşluğa yerleştirme açık

| Ölçü | #8 | #9 | #10 | #11 | #12 |
| --- | --- | --- | --- | --- | --- |
| Tık | 15 | 16 | 16 | 16 | **16** (15 + dosya seçimi) |
| Yazılan değer | 1 | 1 | 1 | 1 | **1** |
| Çıktı | 263 satır | 7,0 KB, 263 satır | 6,9 KB, 263 satır | `Tabela_harfler_S1.tap`, 6,9 KB, 263 satır | **aynı: 7.047 bayt, 263 satır**, kontroller geçti, ≈ 2 dk 11 sn, 16 köprü |

- Değişiklik yok. Küçük işte "işe sığdır" hâlâ yok (harfler plakanın köşesinde birkaç piksel); B44 (P2) bunu taşıyor (`dxf-dialog-1440-dark.png`, `layout-sign-inhole-1440-dark.png`, `sim-sign-1440-dark.png`, `export-sign-1440-dark.png`).

## M8 çıkış kontrolü

Çıkış ölçütü: "NC, DXF, PDF and labels from the server; projects, home and settings complete".

| Ölçüt | Durum | Kanıt / eksik |
| --- | --- | --- |
| NC sunucudan | **Tamam** | Kayıtlı revizyondan üretiliyor, sha256, geçmiş, zip, yeniden üret. Eksik: kontrol listesi sunucuda zorunlu değil (T297, B41) |
| DXF sunucudan | **Tamam** | ezdxf: R12 (AC1009), denetim 0 hata; dizilim 33 nesne (`DIS_KESIM`, `PLAKA`), parçalar 5 nesne |
| PDF sunucudan | **Tamam** | PyMuPDF: A4 4 sayfa (3 plaka + liste), 297 × 210 mm; Türkçe harfler metin olarak doğru (`pdf-layout-a4-sheet1.png`, `pdf-partlist-a4.png`) |
| Etiket sunucudan | **Tamam** | 30 etiket, 2 sayfa, A4 dikey |
| Projeler | **Tamam** (cila var) | Arama, süzgeç, sıralama, kopyala, sil / geri yükle, durum, artık parça sekmesi (ekle / düzenle / sil / "Kullanıldı say"), başka kalınlık → bağlı yeni proje. Eksik: eski revizyon rozeti (T296, B41) |
| Ana sayfa | **Tamam** (cila var) | Sayaçlar, son projeler (küçük dizilim resmi, durum), fire özeti, makine doğrulama. Bir sayaç yanlış etiketli (cila) |
| Ayarlar | **Bir delik** | Genel / Malzemeler / DXF katmanları / Görünüm var ve çalışıyor. **Şirket adı ve logo kaydediliyor ama hiçbir ekranda ve çıktıda kullanılmıyor** (E2); alan altındaki yazı "Ekranda ve çıktılarda görünür" diyor |

**Karar: M8 bugün kapatılamaz.** Kapatmak için üç iş yeter, hepsi küçük:

1. **B41 main'e insin** (T295–T297; PR #139 `ready-to-integrate`, `integration/18` içinde). M8'in kalan üç maddesi bu.
2. **A** (ince tabaka alt sınırı). T293 M8 kapısıydı; aynı açığın öbür kolu açıkken "NC sunucudan" ölçütü güvenli sayılmaz.
3. **E2** (şirket adı ve logo gerçekten kullanılsın, ya da yazı düzeltilsin). "Ayarlar tamam" demek için en küçük çözüm yeter.

B (kilitli Simülasyon kaymıyor) M8 ölçütü değil; D-047'ye göre yine de bir sonraki batch'e girer. E1 ve E3 M9'a kalabilir.

## Saha testine hazırlık: operatör makine gününde neye takılır?

~%90 çizgisi M9 sonu. Aşağıdaki liste bugünkü main'e göre; "nerede" sütunu işin zaten bir görevde olup olmadığını söyler.

**Makineye gitmeden kapanması gerekenler**

| # | Takılacağı yer | Nerede |
| --- | --- | --- |
| 1 | İnce tabaka 0,001 mm yazılabiliyor; küçük parça serbest kalır | **A** (bu inceleme) |
| 2 | Kontroller geçmeyince Simülasyon kaymıyor; düzeltme alanı alt çubuğun altında kalıyor | **B** (bu inceleme) |
| 3 | Proje değişti, listedeki "İndir" eski revizyonun dosyasını işaretsiz veriyor; USB'ye eski dosya gider | T296 (B41) |
| 4 | NC ve belge adları iki kalıpta; makinenin yanında hangi PDF hangi `.tap`'a ait belli değil. Yeni kalıp makine profilindeki "Dosya adı en fazla (karakter)" sınırına uymalı | T295 (B41), kabul maddesi aşağıda |
| 5 | İki post da gerçek makinede hiç çalışmadı; her dosya `(DOGRULANMADI, once air cut)` ile başlıyor. Makine bilgisi (§12.3) ve 2–3 çalışan örnek NC olmadan test günü post ayarıyla geçer | "Field test 1" ön koşulu; T191 `docs/machines/_template/` |
| 6 | Genişletilmiş test programı (delik, cep, kanal, yay, iç kontur) ve basılı saha kontrol listesi yok | T191 |
| 7 | Yeni işlemler için golden / bozuk G-code testleri | T189 (B43, PR #142) |
| 8 | Sunucu ya da bağlantı kesilince kaydedilmeyen değişiklik için uyarı yok | T187 (B43) |

**Takılır ama günü durdurmaz**

| # | Takılacağı yer | Nerede |
| --- | --- | --- |
| 9 | Elle takım değişimi malzemenin 20 mm üstünde; park konumu yok | saha listesi (BACKLOG "Not polish") |
| 10 | Takım sırası bir değişim fazla yapıyor (T2 → T3 → T2) | P5 |
| 11 | Varsayılan ayarlı dosyada `KESIM` başlık satırı yok; operatör dosyaya bakıp köprü var mı bilemiyor | P5 (golden etkisi, D-051) |
| 12 | PDF plaka sayfasında orijin köşesi işaretli değil; plaka kâğıda bakarak yerleştiriliyor | P5 |
| 13 | Her projede köprü ölçüsünü yeniden yazmak gerekiyor: malzeme ayarında köprü alanı yok | **E3** (bu inceleme) |
| 14 | Kenar payını küçültünce "makineye sığmıyor" hatası; sebep kenar payı | **E1** (bu inceleme) |
| 15 | Tahmini süre kalibre değil (≈ 13 dk; rapor kartı 14 dk yazıyor) | sahada ölçülecek; cila |
| 16 | Küçük işte Simülasyon ve Dizilim plakaya sığdırılmış; parça görünmüyor | P2 (B44, PR #145) |
| 17 | İlk açılışta yardım, örnek proje, tur yok; komut paletinde "yardım" araması yalnız kısayol listesini buluyor | T184 (B42), T192 |
| 18 | Çıktılarda şirket adı / logo yok | **E2** (bu inceleme) |
| 19 | Atölye tabletinde / telefonda kullanım: yalnız "kırılmıyor" düzeyinde | mobil geçiş, T188 (B43) |
| 20 | Artık parça kullanılınca parçanın tablada nereye konacağı PDF'te yazıyor mu, denenmedi | T190 "offcut reuse" senaryosunda bakılsın |

Değerlendirme: 1–4 bu hafta kapanır (A, B, B41). 5–8 M9'un kendi işi ve zaten sırada. Bugünkü durumla sahaya çıkılırsa operatörün ilk yarım günü post ayarı ve air cut ile geçer; uygulama tarafında onu durduracak şey 1 ve 3'tür.

## Eksik avı

**Ayarlar** (`settings-general-1440-light.png`, `-dark.png`, `settings-materials-1440-light.png`, `settings-dxf-1440-light.png`, `settings-appearance-1440-light.png`, `-dark.png`): dört sekme, temiz düzen. Varsayılanlar yeni projeye gerçekten geçiyor (boşluk, kenar payı, köprü kipi, giriş, yön denendi). Görünüm: tema, yoğunluk, 3D basit mod, hareket, kısayol listesi. Eksik / pürüz:
- Şirket adı "Kılıç Mobilya Ğüşiöç" yapıldı: API yeni adı dönüyor, yan menü "Atölyem" yazmaya devam ediyor, PDF ve etiket başlığında ad yok; logo için de kullanım yeri yok (E2).
- "Tab adedi, genişliği ve yüksekliği malzeme ayarından gelir" yazıyor; makine formundaki "Malzeme parametreleri" tablosunda köprü sütunu yok (E3).
- Sınır dışı değerde alan kırmızı oluyor, "Varsayılanları kaydet" pasifleşiyor, sebep yazmıyor (`settings-defaults-odd-1440-light.png`).
- Sözcükler Simülasyon'la uyuşmuyor: "Tutucu (tab)" ↔ "Köprü", "Yok, ince taban bırak" ↔ "Kapalı" + "ince tabaka", "Tırmanma (climb)" ↔ "Climb (tırmanma)".

**Makineler** (`machines-1440-light.png`, `-dark.png`, `machines-maintenance-1440-light.png`, `machines-archived-1440-light.png`, `machine-new-1440-light.png`): bakım penceresi (tarih, aralık, not, geçmiş) çalışıyor; gecikince satırda "Bakım gecikti: 81 gün gecikti (31 Ağu 2026)". "Arşivle" tek tıkla arşivliyor, liste "Arşivlenen makineler (1)" + "Geri yükle" gösteriyor; arşivli makine yeni projede seçilemiyor ("Kayıtlı makine yok… Makineler sayfası"), eski proje açılıyor. Yeni makine formunda "Kontrolcü kütüphanesi" (Genel düz G-code, Mach3) var. Pürüz: arşivli makineyi kullanan eski projede 1. adım ve Dışa aktar bunu söylemiyor, NC yine iniyor (`step1-archived-machine-1440-light.png`, `export-archived-machine-1440-light.png`).

**Projeler** (`projects-1440-light.png`, `-dark.png`, `offcuts-1440-light.png`, `-dark.png`, `offcut-dialog-odd-1440-light.png`): durum rozetleri gerçek (Taslak / Üretildi / Tamamlandı). Artık parça sekmesi: elle ekleme, düzenleme, silme, "Kullanıldı say"; adres `?sekme=artik`. Pürüz:
- Satır yüksekliği #11'de ≈ 100 px idi; 3 plakalı projede **205 px** (üç "İndir" bağlantısı alt alta, her biri iki satır). Dosya adı kelime ortasından bölünüyor. 900 px'te 4 proje görünüyor. P4 maddesi kapanmamış.
- Arama ("MUTFAK" → 3 / 12) adrese yazılmıyor.
- Artık parça penceresinde En `0`, Boy `99999`: alanlar kırmızı, sebep yok.
- "Ayrı plaka parçalarını yeni projeye aktar" seçeneği, proje henüz kaydedilmemişse (yeni proje, ilk iş "Dolap ekle") pencerede yok; ad yazılıp kaydedilince geliyor (`cabinet-split-1440-light.png`, `cutlist-split-link-1440-light.png`, `split-project-result-1440-light.png`).

**Ana sayfa** (`home-1440-light.png`, `-dark.png`): gerçek veri, küçük dizilim resimleri, fire özeti. Pürüz:
- "Bu hafta dışa aktarma 16 · Son 7 günde üretilen NC dosyası": sayı bütün dışa aktarma kayıtlarını sayıyor (PDF, DXF, etiket ve silinen projelerinkiler dahil; o anda NC kaydı 11, belge 5). `lib/dashboard.ts` tür süzmüyor.
- Tek makine arşivlenince "Doğrulanmış makine 0 / 0 · Bütün makineler doğrulanmış".

**Dışa aktar**: yukarıdaki doğrulama tablosu. Ek pürüzler: kontrol listesi katın altında (1 plaka y ≈ 1.200, 3 plaka y ≈ 1.335; alt çubuk "İndirmek için kontrol listesini tamamlayın" diyor ama oraya götürmüyor); "Dosyalar" ve geçmişte ad kelime ortasından bölünüyor ("Mutfak_alt_dol / ap_60_S1.tap"); rapor kartı "14 dk", Simülasyon "≈ 13 dk 2 sn".

**Telefon 390 (duman)**: Ana sayfa, Projeler, Artık parçalar, Makineler, Ayarlar (Genel, Görünüm), 1–5. adımlar: yatay kaydırma yok; "İleri" / "İndir" / "Yeni proje" görünür (`home-390-light.png`, `projects-390-light.png`, `machines-390-light.png`, `settings-general-390-light.png`, `sim-390-light.png`, `export-390-light.png`).

## Şimdi düzelt (D-047: en çok 3; bu tur 2)

Numarayı PO verir.

### A. İnce tabaka kalınlığında alt sınır yok: 0,001 mm tabakayla küçük parçalı iş kontrollerden geçiyor

Neden "şimdi": güvenlik; #11 A'nın (T293) öbür kolu. Küçük parça kuralı "köprüyle ya da ince tabakayla tutulur" der; T293 köprüyü sınırladı, tabakayı sınırlamadı. Deneme (tabela, 3 küçük harf, 18 mm MDF, Ø8): 1. adımda "Son pasoda ince tabaka bırak" açık, "Tabaka kalınlığı" `0,001` → kabul; Simülasyon "✓ Tüm kontroller geçti", Dışa aktar yeşil; dosyada kontur `Z-17.9990`'a iniyor, başlık `(KESIM: kopru kapali, kucuk parca ince tabaka 0.001 mm, …)`. Makinede bu tabakasız kesimdir: harfler son pasoda serbest kalır. Alan yalnız "sıfırdan büyük" ve "kalınlıktan küçük" istiyor (`0` ve `18` reddediliyor, `17,99` kabul). Aynı değer proje JSON'undan da geçiyor (`skin.thickness: 0.001` → 201, dosya üretildi). Olası yol: virgül kayması (0,5 yerine 0,05), "ne kadar ince olursa o kadar iyi" düşüncesi.

Spec: §6.3, §7.2 · gcode-safety incelemesi · Depends: T293 · Karar: K2 (#11)

Acceptance:
- [ ] `setSkin` (ve şema) tabaka kalınlığı için alt ve üst sınır uygular; öneri: ≥ 0,3 mm ve ≤ min(2 mm, kalınlık / 2) (kesin sayılar tester + PO ile, `TAB_BOUNDS` yanında tek yerde, DECISIONS'a yazılır, saha testinde ayarlanır). Sınır dışı değer reddedilir, alan sınırı söyler ("0,3–2 mm arası olmalı")
- [ ] doğrulayıcıda kural: küçük parça (ya da küçük göbek) yalnız ince tabakayla tutuluyorsa ve tabaka sınırın dışındaysa hata; Simülasyon ve Dışa aktar aynı satırı gösterir, NC inmez, bağlantı 1. adımdaki alana gider. Eski / elle düzenlenmiş proje de yakalanır
- [ ] "Köprü: Kapalı"nın kendi açtığı 0,5 mm ve varsayılan ayarlı golden dosyalar değişmez
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde

Tester focus: 0,001 / 0,05, sınırın tam üstü ve altı, 18 mm ve 5 mm plaka, proje JSON'undan gelen küçük değer, geri al; gcode-safety listesi; 1440 açık / koyu; axe.

### B. Kontroller geçmeyince Simülasyon ekranı kaymıyor; "Kesim ayarlarına git" düzeni bozuyor

Neden "şimdi": çıkmaz akış, üstelik güvenlik düzeltmesinin yolu üstünde. Kontroller geçmeyince Simülasyon tek sütunlu "Bu dosya indirilemez" görünümüne geçiyor; `main` 844 px yüksekliğinde ve `overflow: hidden`, içerik 1.285 px (4 madde). Fare tekerleği sayfayı kaydırmıyor. Köprü genişliği 1000 denemesinde hata listesi 4 satır tutuyor, "Kesim ayarları" kartının alanları y = 905'te, yani alt çubuğun altında: operatör yanlış değeri yazdığı alana fareyle ulaşamıyor. T293'ün eklediği "Kesim ayarlarına git" bağlantısı gizli kabı 441 px kaydırıyor: alt çubuk ("Geri · 4 / 5 · İleri") ekranın ortasına (y = 402) çıkıp kartın "Adet / Genişlik / Yükseklik" etiketlerini örtüyor, hata listesi yukarıda kalıyor ve geri kaydırılamıyor. Sekme tuşuyla gezince de aynısı oluyor. Kaçış yolu var (başlıktaki "Geri al"), ama ekran bunu söylemiyor (`sim-tab-width-1000-1440-light.png`, `-dark.png`, `sim-tab-width-1000-link-1440-light.png`).

Spec: §3.7, D-045 · Depends: T293

Acceptance:
- [ ] kilitli Simülasyon görünümünde içerik ekrandan uzunsa sayfa fare, dokunma ve klavyeyle kayar; alt çubuk her zaman ekranın altındadır ve içeriği örtmez (1440 × 900, 1024 × 768, 390 × 844)
- [ ] "Kesim ayarlarına git" kartı görünür alana getirir, odağı ilk sorunlu alana koyar; hata listesine geri dönülebilir
- [ ] 6 hata satırıyla e2e: "Kesim ayarları" alanı tıklanabilir, değer düzeltilince görünüm normale döner
- [ ] aynı kap başka adımlarda da kullanılıyorsa (Dışa aktar hata listesi, Parçalar "Uyarılar") aynı kontrol

Tester focus: 1, 4 ve 10 hata satırı; fare tekerleği, Sekme, bağlantı; alt çubuğun kutusu; 1440 açık / koyu; 390 duman; axe.

## Eksikler → yeni görev

### E1. Kenar payı takımın sığmayacağı kadar küçük: hata geç ve yanlış adresle geliyor · **NEW · M9 başı**

Güvenlik değil (dosya inmiyor), D-045 ihlali ("neden olduğu adımda yakala"). Kenar payı 0 (Ayarlar varsayılanı ya da Dizilim alanı) → Dizilim "Sorun bulunmadı" → Simülasyon kilitli: "Kural 6 · Hareket makinenin çalışma alanının dışına çıkıyor: plaka veya parça bu makineye sığmıyor" + "Makine ayarlarını Makineler sayfasından düzeltebilirsiniz". Sebep kenar payı; mesaj makineyi gösteriyor.

Acceptance:
- [ ] Dizilim adımı, kenar payı takım yarıçapı + giriş hareketi için yetmiyorsa uyarır ("Kenar payı Ø8 takım için en az 4 mm olmalı; yoksa takım plakanın dışına çıkar") ve adım göstergesinde işaret kalır
- [ ] Kural 6 hatası plaka kenarına yakın bir parçadan geliyorsa mesaj kenar payını adıyla söyler, bağlantı Dizilim ayarına gider
- [ ] Ayarlar'daki varsayılan alanı aynı notu gösterir (takım bilinmediği için uyarı, engel değil)
- [ ] "Parça arası boşluk" alanının altında "takım çapına ek" notu; boşluk giriş hareketine yetmiyorsa Dizilim'de uyarı ("13 parçada giriş hareketi kaldırılacak")

Tester focus: kenar payı 0 / 3 / 4 / 10, boşluk 0 / 2 / 8; mesaj metinleri; 1440 açık / koyu; axe.

### E2. Şirket adı ve logo kullanılmıyor · **NEW · M8 kapanışı için**

Ayarlar "Ekranda ve çıktılarda görünür" diyor; ad kaydediliyor, yan menü "Atölyem" yazmaya devam ediyor, PDF / etiket başlığında yok; logo yalnız Ayarlar'daki önizlemede.

Acceptance:
- [ ] yan menüdeki şirket satırı kayıtlı adı ve (varsa) logoyu gösterir; kayıttan sonra sayfa yenilemeden güncellenir
- [ ] PDF (plaka sayfası ve parça listesi) başlığında şirket adı ve logo; etikette yer varsa ad. Aynı girdi → aynı bayt kuralı korunur (ad ve logo girdinin parçası)
- [ ] en küçük çözüm (yarım günü aşarsa): yan menü + PDF başlığında ad; logo çıktıda sonraya kalır ve alan altı yazısı buna göre düzeltilir

Tester focus: Türkçe harfli ad, uzun ad (120), logo PNG / JPEG; PDF'i bağımsız okuyucuyla; 1440 açık / koyu.

### E3. Malzeme ayarında köprü varsayılanı girilemiyor · **NEW · M9 (saha testinden önce)**

Üç ekran oraya yönlendiriyor (Ayarlar: "tab ölçüleri makinenin malzeme ayarında"; Kesim ayarları: "Malzeme ayarına dön", kaynak "malzeme ayarından"), şema da destekliyor (`materialParams.tabs`, §3.6), ama makine formundaki "Malzeme parametreleri" tablosunda köprü alanı yok. Operatör kendi makinesinde tutan ölçüyü (ör. 6 × 12 × 2) her projede yeniden yazmak zorunda.

Acceptance:
- [ ] malzeme parametre setinde köprü adet / genişlik / yükseklik alanları (satır ayrıntısında; tablo zaten geniş), T293 sınırlarıyla ve sınırı söyleyen mesajla
- [ ] boş bırakılınca hazır varsayılan (4 × 10 × min(3, kalınlık / 2)) geçerli ve öyle yazıyor
- [ ] Kesim ayarları panelindeki kaynak yazısı ve "Malzeme ayarına dön" bu değerleri gösterir; set değişince profil sürümü artar (doğrulama kuralı aynı)

Tester focus: sınır altı değer formda reddedilir; eski profil (köprü alanı yok) geçerli kalır; yeni projede kaynak "malzeme ayarından".

## Eksikler: mevcut görevle örtüşenler (kabul maddesi önerisiyle)

| Eksik | Görev | Eklenecek kabul maddesi |
| --- | --- | --- |
| Tek ad kalıbı | T295 (B41) | **yeni madde:** ad uzunluğu makine profilindeki "Dosya adı en fazla (karakter)" sınırına uyar; uzun proje adında revizyon ve plaka numarası kesilmez |
| Üretildi / Tamamlandı proje sonradan değişince durum aynı kalıyor | T296 (B41) | **yeni madde:** "Proje durumu" kartı ve Projeler rozeti "üretildikten sonra değişti (Rev. 2; son NC Rev. 1)" der; tek tıkla yeniden üretim |
| Yardım araması boş | T192 | **yeni madde:** komut paletinde "yardım", "air cut", "köprü" aramaları yardım sayfasını bulur |

## Cila kuyruğu (D-047; gruplar BACKLOG "Polish queue (M9)" ile aynı)

14 madde. ★ = daha önce de görülmüş.

**P2 Dizilim, Simülasyon, 3D**
- Özet'teki kesim ayarı satırı 232 px'te kesiliyor ("Köprü: her parçada 4 × 1…"); iki satıra insin. İnce tabaka açıkken satır onu da yazsın [#12]
- Özet "3 uyarı" derken alttaki "Uyarılar" paneli "Sorun bulunmadı" diyor (tabaka bilgi satırları); iki yer aynı sayıyı göstersin [#12]
- Dizilim: "Parça arası boşluk"un takım çapına ek olduğu yazmıyor; giriş hareketinin kaldırılacağı uyarısı yalnız çıktı kontrolünde (E1 ile birlikte yapılabilir) [#12]
- ★ Küçük işte "işe sığdır" (B44'te) [#5, #8, #9, #10, #11, #12]

**P3 Kesim listesi, adım 1, makine formu, DXF**
- Sınır dışı değerde alan yalnız kırmızı, sınırı söylemiyor ve "Kaydet" sessizce pasif: Ayarlar varsayılanları, artık parça penceresi (K2'nin arayüz yarısı) [#12]
- ★ Sözcük birliği: Ayarlar "Tutucu (tab)", "Yok, ince taban bırak", "Tırmanma (climb)" ↔ Simülasyon "Köprü", "Kapalı", "ince tabaka", "Climb (tırmanma)" ↔ 1. adım "ince tabaka" [#11, #12]
- "Ayrı plaka parçalarını yeni projeye aktar" kaydedilmemiş yeni projede de görünsün (ilk kayıt o anda yapılır) [#12]
- Arşivli makineyi kullanan projede 1. adım ve Dışa aktar "bu makine arşivlendi" notu göstersin [#12]

**P4 Kabuk, bildirimler, ana sayfa** (grup B39'da kapandı; kalanlar)
- ★ Projeler: satır 3 plakalı projede 205 px; "Son dışa aktarma" tek satır + "3 dosya" / zip düğmesi olsun, ad kelime ortasından bölünmesin; arama / süzgeç / sıralama adreste tutulsun [#11, #12]
- Ana sayfa "Bu hafta dışa aktarma": ya yalnız NC kayıtlarını saysın ya da etiket "dışa aktarma kaydı" olsun; silinen projeler sayılmasın [#12]
- Ana sayfa: etkin makine yokken "0 / 0 · Bütün makineler doğrulanmış" yerine "Makine yok" [#12]
- Dışa aktar: alt çubuktaki "kontrol listesini tamamlayın" yazısı listeye götürsün ya da liste "Dosyalar"ın üstüne çıksın (1 plaka y ≈ 1.200, 3 plaka y ≈ 1.335) [#12]
- Dışa aktar: "Dosyalar" ve geçmişte dosya adı kelime ortasından bölünüyor; alt çizgi / tireden bölünsün ya da ortadan kısaltılsın [#12]
- Rapor kartı "14 dk" ↔ Simülasyon "≈ 13 dk 2 sn": aynı yuvarlama [#12]

**P5 Çıktı**
- Yeni madde yok; #11'in dört maddesi (orijin köşesi, damar oku, ilk boş etiket, `KESIM` satırı) duruyor. İlki ve sonuncusu saha listesinde 11 ve 12 numara.

## İyi olanlar (koruyun)

- Üç gezinti beşinci turdur aynı sayıda ve bayt bayt aynı dosyalarla bitiyor; B36–B40 varsayılan çıktıya dokunmamış.
- T293 doğru katmanda yapılmış: alan reddediyor, komut reddediyor, doğrulayıcı kaynağa bakmadan yakalıyor, şema anlamsız projeyi 400 ile geri çeviriyor. A için kalıp hazır.
- Dışa aktar adımı: altı tür tek kartta, hepsi geçmişte ve sha256 ile; zip içinde `OKU.txt`; "Yeniden üret" hangi revizyon olduğunu başlıkta söylüyor ve kontrol listesini yeniden istiyor.
- T294: panel artık gösteremediği bir durum bırakmıyor ("ince tabaka da açık · Kapat").
- Ayarlar ve Makineler sade: dört sekme, her kartta tek iş; bakım rozeti makine listesinde.
- Makine arşivi çıkmaz sokak bırakmıyor: yeni projede "Kayıtlı makine yok… Makineler sayfası", eski proje açılıyor, "Geri yükle" tek tık.
- Ana sayfa gerçek: küçük dizilim resimleri aynı adlı projeleri ayırıyor, fire alan ağırlıklı.
- axe 1440 açık / koyu ve 390'da bütün yeni ekranlarda temiz; konsol temiz.

## Karar verildi (sahibi isterse değiştirir)

- **K1 (D-045 ölçüsü):** dolap **16 / 5**, menteşeli kapak **24 / 2**, DXF tabela **16 / 1**; üçü de değişmedi.
- **K2 (genişletildi):** #11 K2 bütün "tutma" değerlerini kapsar: köprü ve ince tabaka aynı sınır tablosunda durur; yeni bir tutma yöntemi eklenirse sınırı olmadan birleşmez (A).
- **K3:** hata görünümü, hatayı düzeltecek alanı ekranın dışında bırakamaz; bir "git" bağlantısı sayfa düzenini değiştiremez (B).
- **K4:** ekrandaki bir yazı kullanıcıyı bir ayara yönlendiriyorsa o ayar ekranda vardır (E2, E3).
- **K5:** M8, B41 + A + E2 main'e inince kapanır; B, E1, E3 M9'un ilk batch'lerine girer.

## Çıktılar

- `docs/reviews/2026-11-20-cto-design-review-12.md` ve `docs/reviews/2026-11-20-cto-12/` (83 görüntü; 1440 × 900, altısı 390 × 844, ikisi PDF sayfası).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

| Ekran | Dosyalar |
| --- | --- |
| Ana sayfa | `home-1440-light.png`, `home-1440-dark.png`, `home-390-light.png` |
| Projeler / artık parçalar | `projects-1440-light.png`, `projects-1440-dark.png`, `projects-390-light.png`, `offcuts-empty-1440-light.png`, `offcuts-1440-light.png`, `offcuts-1440-dark.png`, `offcut-dialog-odd-1440-light.png` |
| Makineler | `machines-1440-light.png`, `machines-1440-dark.png`, `machines-390-light.png`, `machines-maintenance-1440-light.png`, `machines-archived-1440-light.png`, `machine-new-1440-light.png` |
| Ayarlar | `settings-general-1440-light.png`, `settings-general-1440-dark.png`, `settings-general-390-light.png`, `settings-materials-1440-light.png`, `settings-dxf-1440-light.png`, `settings-appearance-1440-light.png`, `settings-appearance-1440-dark.png`, `settings-defaults-odd-1440-light.png`, `settings-defaults-zero-1440-light.png` |
| Şablonlar | `templates-1440-light.png` |
| Adım 1 | `step1-skin-0_01-1440-light.png`, `step1-no-machine-1440-light.png`, `step1-archived-machine-1440-light.png` |
| Kesim listesi / tahta | `cutlist-cabinet-1440-light.png`, `-dark.png`, `cutlist-door-band-1440-light.png`, `-dark.png`, `board-door-1440-light.png`, `-dark.png`, `dxf-dialog-1440-dark.png`, `cabinet-split-1440-light.png`, `cutlist-split-link-1440-light.png`, `split-project-result-1440-light.png` |
| Dizilim | `layout-cabinet-1440-light.png`, `-dark.png`, `layout-door-1440-light.png`, `-dark.png`, `layout-sign-inhole-1440-dark.png`, `layout-kitchen-3sheets-1440-light.png`, `layout-gap0-1440-light.png`, `layout-gap0-margin10-1440-light.png` |
| Simülasyon | `sim-cabinet-1440-light.png`, `-dark.png`, `sim-door-1440-light.png`, `-dark.png`, `sim-sign-1440-dark.png`, `sim-390-light.png`, `sim-skin-0_01-1440-light.png`, `sim-gap0-1440-light.png`, `sim-gap0-margin10-1440-light.png` |
| Kesim ayarları | `sim-cutting-1440-light.png`, `sim-cutting-1440-dark.png`, `sim-cutting-tiny-tab-1440-light.png`, `sim-cutting-off-1440-light.png`, `sim-cutting-roundtrip-1440-light.png`, `sim-tab-width-1000-1440-light.png`, `sim-tab-width-1000-1440-dark.png`, `sim-tab-width-1000-link-1440-light.png` |
| Dışa aktar | `export-cabinet-1440-light.png`, `-dark.png`, `export-door-1440-light.png`, `-dark.png`, `export-sign-1440-dark.png`, `export-sign-top-1440-light.png`, `export-3sheets-1440-light.png`, `export-3sheets-1440-dark.png`, `export-3sheets-ready-1440-light.png`, `export-history-1440-light.png`, `export-status-completed-1440-light.png`, `export-after-edit-1440-light.png`, `export-reexport-dialog-1440-light.png`, `export-skin-0_01-1440-light.png`, `export-tab-width-1000-1440-light.png`, `export-archived-machine-1440-light.png`, `export-390-light.png` |
| PDF (bağımsız okuyucu) | `pdf-layout-a4-sheet1.png`, `pdf-partlist-a4.png` |

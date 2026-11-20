# CTO tasarım ve ürün incelemesi #11 (2026-11-20)

Kapsam: main `ed41a39`. #10'dan beri gelenler: B32 (T172–T174 PDF + etiket), B33 (T287 dizilmeyen parça tutarlılığı, T288 kesim ayarları arayüzü), B35 (T175 DXF yazıcı, T178 Projeler arama / filtre / sıralama / Silinenler, T290 proje kaldığı adımdan açılır). Önceki inceleme: `2026-11-20-cto-design-review-10.md`.

Yöntem #10 ile aynı: üretim derlemesi, boş PGlite, port 3210, Playwright ile 1440 × 900 açık / koyu, üç operatör gezintisi (D-045), 390 px yalnızca duman testi (D-043). Bu turda dört odak vardı:

1. #10'un A, E1, E5 bulgularının ve M8 çıktılarının (PDF, etiket, DXF) doğrulanması. Dosyalar uygulamanın dışında, bağımsız okuyucularla açıldı: PDF için PyMuPDF 1.x, DXF için ezdxf (denetim + çizdirme).
2. Üç gezinti.
3. Yeni ekranlarda kısa eksik avı: Dışa aktar, Projeler, Simülasyon "Kesim ayarları".
4. Kesim ayarları paneli operatör için güvenli ve anlaşılır mı (yanlış köprü değeri girmek zor mu).

47 görüntü `2026-11-20-cto-11/` klasöründe. Ürün koduna, BACKLOG'a ve DECISIONS'a dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (en çok 3 "şimdi düzelt"), D-045, D-043.

Sınırlar: tıklar betikte gerçek olay sayımıdır (`isTrusted`); dosya seçimi tıksız yapıldığı için elle +1 eklendi. Denenmeyenler: gerçek yazıcıda etiket baskısı ve kaydırma ayarı, LibreCAD ile elle açma (ezdxf denetimi ve çizimi yapıldı), 50+ projede sayfalama, sunucu kesintisi (T187), 1024 px, dokunmatik. Konsolda hata ya da uyarı görülmedi. axe (ciddi / kritik): Ana sayfa, Simülasyon (panel açık) ve Dışa aktar açık / koyu temiz.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | #7 | #8 | #9 | #10 | #11 | Not |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | 7,5 | 7,5 | 8 | 8 | **8,5** | PDF ve etiketler ürünün en "kurumsal" çıktısı oldu: temiz başlık, Türkçe harfler doğru, bant ve damar işaretleri okunur. Projeler sayfası tam. Tutan: kalan bildirim, montaj kamerası, boş taslaklar |
| Modernlik | 8 | 8 | 8 | 8 | 8 | 8,5 | 9 | 9 | **9** | Değişmedi |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | 8 | 8,5 | 8,5 | 8,5 | **8,5** | A, E1, E5 kapandı; gezintiler aynı sayıda. Puanı tutan yeni şey: kesim ayarları paneli katın altında, hata metinleri sınırı söylemiyor, anlamsız köprü ölçüsünü kabul ediyor (A) |
| M4–M7 için hazır olma | 7,5 | 8 | 8 | 8,5 | 8,5 | 9 | 9 | 9 | **9** | Gerileme yok |
| Saha testine hazır olma | – | – | – | – | – | – | – | 7 | **7,5** | PDF, etiket ve DXF dosyaları doğru üretiliyor; kesim ayarı arayüzü ve kaldığı adımdan açılma geldi. Eksik: köprü ölçüsü alt sınırı (A), DXF'in ekranda düğmesi yok ve belgeler geçmişe yazılmıyor (T176), proje durumu (T179), makine arşivi (T289), yardım ve örnek proje (M9) |

Özet: #10'un üç bulgusu da doğru kapanmış, M8'in üç dosya türü bağımsız okuyucularda hatasız açılıyor ve ekrandaki dizilimle birebir aynı. Bu turdan **1 "şimdi düzelt"** (köprü ölçüsünde alt sınır yok; 0,1 × 0,01 mm köprüyle küçük parçalı iş bütün kontrollerden geçip iniyor), **1 yeni görev adayı**, **mevcut görevlere 5 kabul maddesi** ve **13 cila** maddesi çıktı.

## #10 bulgularının doğrulanması

| Bulgu | Görev | Sonuç | Kanıt |
| --- | --- | --- | --- |
| A. Dizilmeyen parça: Simülasyon yeşil demesin, Dışa aktar parçayı adıyla söylesin | T287 | **Kapandı** | Dizilim'de sekmelerin yanında "1 parça dizilimde yok" çipi (y = 144, kaydırmasız). Simülasyon: "✕ 1 kontrol geçmedi · Satır 2 · Tezgah · Parça plakaya sığmıyor" açık geliyor. Dışa aktar aynı satırı yazıyor, "Parçalara git" 2. satırın Ad hücresini odaklıyor. Sonradan eklenen parça: "2 kontrol geçmedi · Satır 3 · Sonradan · Parça dizilimde yok" (`layout-oversize-1440-light.png`, `sim-oversize-1440-light.png`, `export-oversize-1440-light.png`) |
| E1. Kesim ayarları arayüzü | T288 | **Kapandı, bir güvenlik açığıyla (A)** | Panel var; her değişiklik geri alınır bir komut; köprü sayısı anında güncelleniyor (32 → 8 → 160 → 64); yön değişince yaylar ters dönüyor (G2 / G3: 16 / 90 → 90 / 16), giriş düz olunca giriş hareketleri değişiyor; indirilen dosyanın başlığında `(KESIM: ...)` satırı var. Aşağıdaki "Kesim ayarları paneli" bölümüne bakın |
| E5. Proje kaldığı adımdan açılsın | T290 | **Kapandı** | NC indirilmiş proje "Aç" ile Dışa aktar'da, yalnız dizilmiş proje Dizilim'de açıldı; adres `?adim=` olmadan geliyor |

## M8 çıktıları: bağımsız okuyucuyla

Deneme projesi: "Çekmeceli mutfak İğşöü", damarlı plaka, 5 satır / 30 parça / 3 plaka, dört farklı bant düzeni, uzun adlı bir parça. Ek olarak menteşeli kapak (cep + delik), DXF tabela (yay + iç kontur) ve dizilmeyen parçalı proje.

| Dosya | Okuyucu | Sonuç |
| --- | --- | --- |
| PDF A4 / A3 (T172, T173) | PyMuPDF | 4 sayfa = 3 plaka + parça listesi; sayfa 297 × 210 ve 420 × 297 mm; Inter gömülü, "Çekmeceli mutfak İğşöü" ve "ığüşöç" metin olarak doğru çıkıyor; aynı istek iki kez aynı özet (`4660faec…`). Plaka sayfası ekrandaki dizilimle aynı yön ve konumda (`pdf-layout-a4-sheet2.png` ↔ `layout-kitchen-3sheets-1440-light.png`). Liste: bitmiş / kesim ölçüsü, adet, damar, bant simgesi ve "Üst 2 · Sağ 2 · Alt 2 · Sol 2"; fire %43,6, 3 plaka, 30 parça, ≈ 50 dk (`pdf-partlist-a4.png`) |
| Etiket (T174) | PyMuPDF | 3 × 8: 30 etiket, 2 sayfa; 2 × 7: 3 sayfa; etiket sayısı = parça sayısı. Sıra plakaya göre (Plaka 1, 2, 3), her etikette no, ad, bitmiş ölçü, kesim ölçüsü, damar oku, bant kenarı, proje (`pdf-labels-a4-3x8.png`). Özel ızgara sayfaya sığmayınca 400 |
| DXF dizilim / parçalar (T175) | ezdxf | R12 (AC1009), birim mm, denetim 0 hata / 0 düzeltme. Katmanlar `DIS_KESIM`, `IC_KESIM`, `CEP`, `DELIK`, `CIZGI`, `PLAKA`. Mutfak: 3 plaka yan yana (0…8.600 mm), 30 kapalı kontur. Kapak: menteşe yuvaları `CEP`, kulp delikleri `DELIK` katmanında daire. Tabela: yaylar bulge olarak korunmuş, O'nun içi `IC_KESIM` (`dxf-layout-ezdxf.png`, `dxf-sign-parts-ezdxf.png`) |
| Dizilmeyen parçalı proje | ikisi de | PDF listesi "2 parça dizilmedi" ve satırda "0/1 dizildi" yazıyor, süre yerine "G-code kontrolleri geçince hesaplanır"; etikette "Dizilmedi" (`pdf-partlist-unplaced.png`). Dürüst ve doğru |

Sonuç: üç dosya türü de doğru. Kalan iş dosyanın kendisi değil, ekrana bağlanması (T176): DXF'in Dışa aktar adımında düğmesi yok (yalnız `/api/projects/:id/dxf`), PDF ve etiket geçmiş tablosuna yazılmıyor.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

| Ölçü | #7 | #8 | #9 | #10 | #11 |
| --- | --- | --- | --- | --- | --- |
| Tık | 16 | 16 | 16 | 16 | **16** |
| Yazılan değer | 5 | 5 | 5 | 5 | **5** |
| Çıktı | 12,2 KB, 511 satır | `Adsiz_projeMutfak_alt_dol_S1.tap` | 12,2 KB, 511 satır | 12,2 KB, 511 satır | **`Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, 511 satır**, kontroller geçti, 1 plaka, 32 köprü |

- Gerileme yok (`cutlist-cabinet-1440-light.png`, `layout-cabinet-1440-light.png`, `sim-cabinet-1440-light.png`, `export-cabinet-1440-light.png`).
- Varsayılan ayarlarla dosya bayt sayısı ve satır sayısı #10 ile aynı: T288 varsayılan çıktıyı değiştirmemiş.
- #10'un notu (8 büyük parçada 32 köprü) artık operatörün elinde: "Yalnız küçük parçada" seçilince 0 köprü.

## Gezinti 2: menteşeli kapak, 4 kenar bant + hazır şablon → NC

| Ölçü | #8 | #9 | #10 | #11 |
| --- | --- | --- | --- | --- |
| Tık | 26 | 24 | 24 | **24** |
| Yazılan değer | 3 | 2 | 2 | **2** |
| Çıktı | 235 satır | 236 satır | 6,7 KB, 236 satır | **`Menteseli_kapak_60_S1.tap`, 6,7 KB, 236 satır**, kontroller geçti, T1 → T2, ≈ 2 dk 38 sn |

- Menteşe yuvaları X 22,5 (Sol), kulp delikleri X 566 (Sağ); 6 onay eksiksiz; dosyanın 2. satırı `(SABLON DOGRULANMADI: …)` (`board-door-1440-light.png`, `sim-door-1440-light.png`, `export-door-1440-light.png`).

## Gezinti 3: DXF tabela, iç boşluğa yerleştirme açık

| Ölçü | #8 | #9 | #10 | #11 |
| --- | --- | --- | --- | --- |
| Tık | 15 | 16 | 16 | **16** (15 + dosya seçimi) |
| Yazılan değer | 1 | 1 | 1 | **1** |
| Çıktı | 263 satır | 7,0 KB, 263 satır | 6,9 KB, 263 satır | **`Tabela_harfler_S1.tap`, 6,9 KB, 263 satır**, kontroller geçti, ≈ 2 dk 11 sn, 16 köprü |

- Değişiklik yok; #9 cilaları (küçük işte "işe sığdır" yok, iç boşluk sonuç değiştirmeyince geri bildirim yok) aynen duruyor (`dxf-dialog-1440-dark.png`, `layout-sign-inhole-1440-dark.png`, `sim-sign-1440-dark.png`, `export-sign-1440-dark.png`).

## Kesim ayarları paneli: güvenli ve anlaşılır mı?

Deneme: dolap projesinde (büyük parçalar) ve tabela projesinde (3 küçük harf + iç kontur) Adet, Genişlik, Yükseklik alanlarına iyi ve kötü değerler yazıldı.

| Girilen | Sonuç | Değerlendirme |
| --- | --- | --- |
| Adet 0, −1 | "Sıfırdan büyük olmalı." | Doğru |
| Adet 21, 2,5 · Yükseklik 18, 50 (plaka 18 mm) | "Bu değer kabul edilmedi." | Reddediyor ama sınırı söylemiyor (1–20, tam sayı, plaka kalınlığından küçük) |
| Adet 20 | kabul, 160 köprü | Uyarı yok; "Adet"in parça başına olduğu yazmıyor |
| Adet 1 (tabela) | kabul, küçük parçada yine 2 köprü | Güvenlik kuralı tutuyor; başlık ise "1 adet" yazıyor |
| Genişlik 1000 (tabela) | Simülasyon kilitlenir: "Bu dosya indirilemez", 4 madde | **Güvenlik ağı çalışıyor.** Ama mesaj sebebi söylemiyor: "Parçalara git" / "Çizimde aç" ve "Kesim ayarlarında 'Son pasoda ince tabaka bırak' seçeneğini açın"; o adda bir seçenek panelde yok (`sim-tab-width-1000-1440-light.png`) |
| Genişlik 300, 1000 (dolap) | kabul, köprü 15 / 0, "uyarı" | Büyük parçada kabul edilebilir |
| **Genişlik 0,1 · Yükseklik 0,01 (tabela)** | **kabul; "✓ Tüm kontroller geçti"; dosya indi** | **A: şimdi düzelt** (`sim-cutting-tiny-tab-1440-light.png`, `export-tiny-tab-1440-light.png`) |
| Yükseklik 17,9 (plaka 18) | kabul | Köprü neredeyse tam kalınlık; kırmak yerine kesmek gerekir. Uyarı yok |
| Kapalı | 0,5 mm ince tabaka açılır, ipucu bunu söyler | Doğru (`sim-cutting-off-1440-light.png`) |
| Kapalı → Her parçada | ince tabaka **açık kalır**, panel bunu göstermez | Gizli durum: 1. adımda anahtar açık, başlıkta "küçük parça ince tabaka 0.500 mm" (`step1-skin-after-off-1440-light.png`) |

Genel: panelin mantığı doğru (proje > malzeme ayarı > hazır varsayılan, "Malzeme ayarına dön", her değişiklik geri alınır, çıktı aynı değerleri kullanır). Küçük parça kuralı adet ve aşırı genişlikte devreye giriyor. Açık kalan tek delik alt sınır: genişlik ve yükseklik için yalnız "sıfırdan büyük" koşulu var; köprü genişliği malzemede kalan gerçek genişlik olduğundan (`toolpath/tabs.ts`) 0,1 mm yazan operatör köprüsüz kesim alıyor ve hiçbir ekran bunu söylemiyor.

Görünürlük: 1440 × 900'de kart sol panelde y ≈ 790'da başlıyor; operatör yalnız "Kesim ayarları" başlığını görüyor, alanlar için paneli kaydırması gerekiyor (`sim-cabinet-1440-light.png`, kaydırılmış hali `sim-cutting-1440-light.png` / `-dark.png`). 232 px genişlikte seçenekler alt alta diziliyor, kart 754 px.

## Eksik avı: yeni ekranlar

**Dışa aktar** (`export-3sheets-1440-light.png`, `-dark.png`, `export-labels-custom-1440-light.png`): "Belgeler (PDF) ve etiketler" kartı sol sütunda; PDF A4 / A3 yeni sekmede açılıyor, etiket kağıdı (3 × 8, 2 × 7, özel ızgara) ve yazıcı kaydırma ayarı var, "30 etiket, 2 sayfa" sayısı doğru. Belgeler kontrol listesi beklemiyor (doğru: NC değiller). Eksik: DXF düğmesi yok; PDF / etiket geçmişe yazılmıyor; çok plakada toplu indirme hâlâ yok (hepsi T176). Dosya adları üç ayrı kalıpta: `…_S1.tap`, `…-r2-A4.pdf`, `…_r2_dizilim.dxf`. Kart 1440'ta katın altına uzuyor; "Etiketleri aç" için kaydırmak gerekiyor (T176'daki iki sütun notu).

**Projeler** (`projects-1440-light.png`, `-dark.png`, `projects-deleted-1440-light.png`, `projects-empty-search-1440-light.png`, `project-deleted-link-1440-light.png`): arama Türkçe katlamayla çalışıyor ("MUTFAK" 4 / 10, "menteseli" 3 / 10, "cekmeceli igsou" 1 / 10); durum, makine, malzeme süzgeçleri ve dört sıralama çalışıyor; Kopyala "… (kopya)" üretiyor; Sil + "Geri al"; Silinenler sekmesi adreste (`?sekme=silinenler`), "Geri yükle" var; silinen projenin doğrudan bağlantısı "Silinen proje açılmaz" + "Geri yükle" gösteriyor. Eksik / pürüz:
- Durum süzgecinde "Üretildi" ve "Tamamlandı" var ama hiçbir proje bu duruma geçemiyor; NC indirilmiş projeler de "Taslak" (T179).
- Listede "İndir: Mutfak_alt_dolap_60_S1.tap" Rev. 1 dosyasını veriyor; proje o arada Rev. 11 olmuş (kesim ayarı değişmiş). Satırda "eski revizyon" işareti yok; operatör listeden eski dosyayı makineye götürebilir (T179'a kabul maddesi).
- Arama, süzgeç ve sıralama adreste tutulmuyor; yenileyince "Son değişen"e dönüyor.
- Satırlar yüksek (≈ 100 px; 900 px'te 4,5 proje), dosya adı "S1. tap" diye bölünüyor; aynı adlı projeler birbirinden ayrılmıyor.

**Simülasyon "Kesim ayarları"**: yukarıdaki bölüm.

**Ana sayfa** (`home-1440-light.png`, `-dark.png`): değişmedi; boş taslaklar hâlâ "Son projeler"de.

**Telefon 390 (duman)**: Ana sayfa, Projeler, Silinenler, 1–4. adımlar ve Dışa aktar'da yatay kaydırma yok; "İleri" / "İndir" / "Yeni proje" görünür; PDF düğmeleri erişilir (`home-390-light.png`, `projects-390-light.png`, `sim-390-light.png`, `export-390-light.png`). Kesim ayarları kartı 390'da ilk görünümde yok (panel düğmesinin arkasında); mobil geçişte bakılır.

## Şimdi düzelt (D-047: en çok 3; bu tur 1)

Numarayı PO verir.

### A. Köprü ölçüsünde alt sınır yok: 0,1 × 0,01 mm köprüyle küçük parçalı iş kontrollerden geçiyor

Neden "şimdi": güvenlik. Küçük parça kuralı (§6.3, §7.2) "küçük parça köprüyle ya da ince tabakayla tutulur" der; kural köprünün varlığını sayıyor, tutup tutamayacağını değil. Deneme (tabela, 3 küçük harf, 18 mm MDF, Ø8 takım): Genişlik `0,1`, Yükseklik `0,01` → "✓ Tüm kontroller geçti", Dışa aktar yeşil, dosya indi; başlık `(KESIM: kopru her parcada 1 adet 0.100 x 0.010 mm, giris yay, yon climb)`. Makinede bu, köprüsüz kesimdir: harfler son pasoda serbest kalır ve takım onları fırlatabilir. Olası yol: virgül kayması (10 yerine 0,1), cm / mm karışıklığı. Aynı değerler komutla (API, ileride AI değil ama içe aktarma) kayıtlı projeye de girebilir, bu yüzden kontrol yalnız alanda değil doğrulayıcıda olmalı.

Spec: §6.3, §7.2 · gcode-safety incelemesi · Depends: T288

Acceptance:
- [ ] `setTabs` genişlik ve yükseklik için alt sınır uygular; öneri: genişlik ≥ 3 mm, yükseklik ≥ 1 mm ve ≤ kalınlık − 1 mm (kesin sayılar tester + PO ile; saha testinde ayarlanır, DECISIONS'a yazılır). Sınır dışı değer reddedilir, alan sınırı söyler ("En az 3 mm", "1–17 mm arası", "1–20 arası tam sayı")
- [ ] doğrulayıcıda kural: küçük parça yalnız köprüyle tutuluyorsa (ince tabaka yok) ve köprü ölçüsü sınırın altındaysa hata; Simülasyon ve Dışa aktar aynı satırı gösterir, NC inmez. Eski / elle düzenlenmiş proje de yakalanır
- [ ] köprü yerleşmediği için kilitlenen işte (ör. genişlik 1000) mesaj sebebi adıyla söyler ("Köprü genişliği 1.000 mm bu parçaya sığmıyor") ve bağlantı Kesim ayarları'na gider; "Son pasoda ince tabaka bırak" yerine panelde gerçekten bulunan seçenek adı ("Köprü: Kapalı") yazılır
- [ ] varsayılan değerlerle golden dosyalar değişmez; yeni golden gerekirse D-051
- [ ] yarım günü aşarsa en küçük çözüm: ilk iki madde

Tester focus: 0,1 / 0,01, sınırın tam üstü ve altı, 18 mm ve 5 mm plaka (kalınlık / 2 kuralıyla birlikte), malzeme ayarından gelen küçük değer, geri al; gcode-safety listesi; 1440 açık / koyu; axe.

## Eksikler → yeni görev

### E1. Kesim ayarları: gizli durum ve açıklık · **NEW · M8 sonu ya da M9 başı (saha testinden önce)**

Güvenlik değil, yanlış anlaşılma riski; A ile aynı dosyalara dokunduğu için arkasından gelebilir.

Acceptance:
- [ ] "Kapalı → Her parçada" gidiş dönüşü projeyi başladığı duruma getirir (panelin kendi açtığı ince tabakayı kapatır) ya da panel durumu açıkça gösterir: "Küçük parçalarda 0,5 mm ince tabaka açık (1. adım)" + "Kapat"
- [ ] "Adet" etiketi "Adet (parça başına)"; küçük parçada en az 2 kuralı devredeyken alanın altında not ("küçük parçalarda en az 2") ve başlıktaki `KESIM` satırı gerçekte kullanılan sayıyı yazar
- [ ] 1440 × 900'de kartın köprü seçimi kaydırmadan görünür (makine kartı tek satıra iner ya da "Kesim ayarları" Özet'in üstüne çıkar); Özet'te tek satır "Köprü: her parçada 4 × 10 × 3 mm · Giriş: yay · Yön: climb"
- [ ] kesim yönü seçeneklerinin altında bir satır yönlendirme (hangi durumda hangisi); yükseklik kalınlığın yarısını geçince uyarı ("köprüyü kırmak zor olur")

Tester focus: gidiş dönüş sonrası proje JSON'u ve dosya başlığı; 1440 açık / koyu; axe.

## Eksikler: mevcut görevle örtüşenler (kabul maddesi önerisiyle)

| Eksik | Görev | Eklenecek kabul maddesi |
| --- | --- | --- |
| DXF'in Dışa aktar adımında düğmesi yok (yalnız API) | T176 | zaten kapsamda; "dizilim" ve "parçalar" iki ayrı seçenek olarak görünsün |
| PDF ve etiket geçmiş tablosuna yazılmıyor | T176 | zaten kapsamda |
| Dosya adları üç kalıpta (`_S1.tap`, `-r2-A4.pdf`, `_r2_dizilim.dxf`) | T176 | **yeni madde:** tek ad kalıbı (aynı ayırıcı, revizyon her türde aynı yerde) |
| Belgeler kartı katın altında | T176 | #4 notu (iki sütun dengesi) geçerli |
| Proje durumu hep "Taslak"; süzgeçte boş "Üretildi / Tamamlandı" | T179 | zaten kapsamda |
| Projeler listesinde "İndir" eski revizyonun dosyasını işaretsiz veriyor | T179 | **yeni madde:** son dışa aktarma güncel revizyondan eskiyse satırda "eski revizyon" rozeti; indirme yine mümkün |
| Arama / süzgeç / sıralama adreste değil | T178 (kapandı) | cila P4 |
| Makine arşivi, artık parça elle ekleme, başka kalınlık | T289, T291, T292 | değişiklik yok (sırada) |
| Varsayılan köprü / giriş değerleri şirket ayarı | T182 | **yeni madde:** A'nın alt sınırları burada da geçerli |

## Cila kuyruğu (D-047; gruplar BACKLOG "Polish queue (M9)" ile aynı)

13 madde. ★ = daha önce de görülmüş.

**P2 Dizilim, Simülasyon, 3D**
- Kesim ayarları kartı dar panelde uzun: üç köprü seçeneği alt alta, üç alan tek sütun (754 px). Seçenekleri tek satır parçalı düğme, alanları üçlü satır yapın [#11]
- Hatalı değer alanda kırmızı kalırken kullanılan değer görünmüyor ("21" yazılı, 4 kullanılıyor); odak çıkınca geçerli değere dönsün ya da "kullanılan: 4" yazsın [#11]

**P3 Kesim listesi, adım 1, makine formu, DXF**
- Adım 1'deki "ince tabaka" anahtarı ile Simülasyon'daki "Köprü: Kapalı" aynı ayarın iki adı; iki yerde aynı sözcük kullanılsın ve birbirine bağlantı versin [#11]

**P4 Kabuk, bildirimler, ana sayfa**
- ★ Bildirim adım değişince kalıyor: "5 satır eklendi · Geri al" Dizilim'de ölçek çubuğunun üstünde (`layout-kitchen-3sheets-1440-light.png`) [#8, #9, #10, #11]
- ★ Boş taslaklar listede birikiyor (yarım kalan her deneme kalıcı bir satır bırakıyor) [#10, #11]
- Projeler: arama, süzgeç ve sıralama adreste tutulsun (Silinenler sekmesi gibi) [#11]
- Projeler: satır yüksekliği (≈ 100 px); "Son dışa aktarma" hücresi tek satır + simge düğme olsun, dosya adı kelime ortasından bölünmesin [#11]
- Projeler: aynı adlı projeleri ayırmak için küçük dizilim resmi ya da plaka sayısı (T180 küçük resmiyle birlikte) [#11]
- Dışa aktar: "PDF aç" yeni sekmede açıyor; yanında "indir" seçeneği (`download=1` zaten var) [#11]

**P5 Çıktı**
- PDF plaka sayfası: orijin köşesi (X0 / Y0, "ön sol") işaretlensin; operatör plakayı kâğıda bakarak yerleştiriyor (golden etkisi yok) [#11]
- PDF plaka sayfası: küçük parçada damar oku parça adının üstüne biniyor (5.1) [#11]
- Etiket: yarım kullanılmış kağıt için "ilk boş etiket" (başlangıç konumu) [#11]
- `KESIM` başlık satırı varsayılan ayarlarda yazılmıyor (golden korumak için); saha testinden önce her dosyada yazılması değerlendirilsin, operatör dosyaya bakarak köprü olup olmadığını bilsin (golden etkisi: D-051) [#11]

## İyi olanlar (koruyun)

- Üç gezinti dördüncü turdur aynı sayıda ve aynı dosyalarla bitiyor; T288 varsayılan çıktıya dokunmamış.
- T287 tam istenen kalıpta: sorun üç adımda da aynı cümleyle, parça adıyla ve tek tıkla düzeltme yoluyla görünüyor.
- PDF ve etiketler: Türkçe harfler, bant simgeleri, bitmiş / kesim ölçüsü ayrımı, plakaya göre etiket sırası, dizilmeyen parçanın açıkça yazılması, aynı girdiye aynı bayt.
- DXF: R12, mm, doğru katmanlar, yaylar bulge; denetim temiz. Başka bir CAM'e ya da lazerciye gönderilebilir durumda.
- Kesim ayarlarında değerin kaynağı yazıyor ("hazır varsayılan" / "malzeme ayarından" / "bu projeye özel") ve "Malzeme ayarına dön" var.
- Silinen projenin bağlantısı çıkmaz sokak değil: açıklama + "Geri yükle".
- Aşırı geniş köprüde küçük parça kuralı işi kilitliyor (güvenlik ağı çalışıyor; eksik olan alt uç).

## Karar verildi (sahibi isterse değiştirir)

- **K1 (D-045 ölçüsü):** dolap **16 / 5**, menteşeli kapak **24 / 2**, DXF tabela **16 / 1**; üçü de değişmedi.
- **K2:** operatörün yazdığı her üretim değeri için alt ve üst sınır hem alanda hem doğrulayıcıda bulunur; "sıfırdan büyük" bir güvenlik değeri için yeterli sınır değildir (A'nın genel kuralı).
- **K3:** bir ayar ekranı, projeyi kendi başlattığı duruma geri getirebilmelidir; ekranın gösteremediği bir durum (her parçada köprü + ince tabaka) ya gösterilir ya da oluşmaz (E1).
- **K4:** belgeler (PDF, etiket, DXF) NC kilidine bağlı değildir; dizilmeyen parçayı kendi içinde açıkça yazmaları yeterlidir (bugünkü davranış doğru, korunur).

## Çıktılar

- `docs/reviews/2026-11-20-cto-design-review-11.md` ve `docs/reviews/2026-11-20-cto-11/` (47 görüntü; 1440 × 900, dördü 390 × 844, dördü PDF sayfası, ikisi ezdxf çizimi).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

| Ekran | Dosyalar |
| --- | --- |
| Ana sayfa | `home-1440-light.png`, `home-1440-dark.png`, `home-390-light.png` |
| Projeler | `projects-1440-light.png`, `projects-1440-dark.png`, `projects-deleted-1440-light.png`, `projects-empty-search-1440-light.png`, `project-deleted-link-1440-light.png`, `projects-390-light.png` |
| Kesim listesi / tahta | `cutlist-cabinet-1440-light.png`, `cutlist-door-band-1440-light.png`, `cutlist-oversize-1440-light.png`, `dxf-dialog-1440-dark.png`, `board-door-1440-light.png` |
| Adım 1 | `step1-skin-after-off-1440-light.png` |
| Dizilim | `layout-cabinet-1440-light.png`, `layout-door-1440-light.png`, `layout-sign-inhole-1440-dark.png`, `layout-oversize-1440-light.png`, `layout-kitchen-3sheets-1440-light.png`, `layout-kitchen-1440-dark.png` |
| Simülasyon | `sim-cabinet-1440-light.png`, `sim-cabinet-1440-dark.png`, `sim-door-1440-light.png`, `sim-sign-1440-dark.png`, `sim-oversize-1440-light.png`, `sim-390-light.png` |
| Kesim ayarları | `sim-cutting-1440-light.png`, `sim-cutting-1440-dark.png`, `sim-cutting-off-1440-light.png`, `sim-cutting-tiny-tab-1440-light.png`, `sim-tab-width-1000-1440-light.png` |
| Dışa aktar | `export-cabinet-1440-light.png`, `export-door-1440-light.png`, `export-sign-1440-dark.png`, `export-3sheets-1440-light.png`, `export-3sheets-1440-dark.png`, `export-labels-custom-1440-light.png`, `export-oversize-1440-light.png`, `export-tiny-tab-1440-light.png`, `export-390-light.png` |
| PDF / DXF (bağımsız okuyucu) | `pdf-layout-a4-sheet2.png`, `pdf-partlist-a4.png`, `pdf-labels-a4-3x8.png`, `pdf-partlist-unplaced.png`, `dxf-layout-ezdxf.png`, `dxf-sign-parts-ezdxf.png` |

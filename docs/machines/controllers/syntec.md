# Syntec (Syntec Technology, Tayvan)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: orta-yüksek (G/M kod sözdizimi Syntec'in kendi Mill Programming Manual'larından okundu; dosya/USB kuralları ahşap operasyon kılavuzundan; satır sonu, karakter seti ve PLC M-kodları kaynaklarda yok).

## Özet (post yazacak kişi için)
- Syntec freze (900M/6MA/6MB/60W ailesi) Fanuc 0M'e çok yakın ISO G-kodu okur; üreticinin kendi ifadesiyle tek fark birim kodları: inç/mm için **G70/G71**, Fanuc'taki G20/G21 yerine [1][3]. Post mm için `G71` yazmalı. G21'in kabul edilip edilmediği kaynakta yok (bilinmiyor).
- **Ondalık nokta zorunlu kabul edilmeli.** Varsayılan ayarda noktasız sayı en küçük birim olarak okunur: `X100` = 0.1 mm, `G04 X2500` = 2.5 s [1][3]. Hesap makinesi tipi okuma (noktasız = mm) yalnız parametre ile açılıyor (Pr3241 "decimal point type" 0: standart, 1: pocket) [5]. Post her X/Y/Z/I/J/K/R/F değerine nokta yazmalı (Fusion Syntec postu da hep nokta yazıyor [6]).
- Yay: `G02/G03` için I/J/K **her zaman başlangıç noktasından merkeze artımlı** (G90/G91'den bağımsız); `R` de var (180 derece üstü için negatif R), tam daire yalnız IJK ile [1][3]. Kod listesinde **G90.1/G91.1 yok** [1][3]; post `distanceModeWord: null` kullanmalı.
- Bekleme: `G04 X2.5` = 2.5 s (noktalı X = saniye), `G04 P2500` = 2.5 s (P = ms, nokta yasak) [1][3]. Güvenli seçim: `G04 P<ms>` tam sayı (Fusion postu böyle yazıyor [6]).
- Takım değişimi: `T03 M06` (T ve M06 birlikte; M06 tek başına takım seçmez) [1]. Uzunluk telafisi `G43 Z_ H_`, iptal `G49` [1].
- Koordinatlar: G54..G59 + **G59.1..G59.9** (toplam 15 iş koordinatı); Fanuc'taki `G54.1 P` kaynaklarda yok [1][3]. `G53` tek blokluk, yalnız G90'da, öncesinde telafiler iptal edilmeli [1].
- Program dosyası: Fusion postu `%` + `O####` + `.nc` yazar [6]; ahşap kontrolcüde dosya adı serbest, uzantı serbest/boş olabilir, **en fazla 32 karakter (uzantı dahil)** [4]. 60W "working list" ekranı uzantıyı ayardan bekler (ör. `.nc`); yanlışsa liste boş görünür [4].
- Vakum, pim, toz emme M-kodları Syntec standardında **yok**; standart M listesi M00-M09, M19, M30, M98/M99 [1]. Diğerleri PLC'de makine üreticisi tarafından tanımlanır: **makine üreticisine bağlı**.

## Sürümler / donanım
- Bu not "Syntec Mill Machine Program Manual" V8.16 (2013) [2], V8.20 (2015) [1] ve 2020 tarihli yeni Mill Machine Program Manual'a [3] dayanır. Kılavuzlar kendini "SYNTEC 900M" G-kodu olarak tanımlar ve freze tipi tüm Syntec kontrolcülere (6MA/6MB, 21MA/MB, 220MA vb.) aynı dili uygular [1][3]. Hangi modelin hangi sürümle geldiği kaynakta tek tek listelenmiyor.
- Ahşap serisi: 60WA/600WA/610WA-H/610WB-H/60W-E için ayrı bir operasyon kılavuzu var (2023) [4]. Bu kılavuz yalnız operasyonu anlatıyor, G-kodu yine Mill kılavuzundan.
- ATC'li Çin/Tayvan router'larında yaygın. Laguna gibi üreticiler de Syntec kullanıyor [7]. Türkiye'deki yaygınlık için bu araştırmada kaynak yok.

## 1. Program dosyası
- Başlangıç/bitiş: Fusion Syntec postu ilk satıra `%`, sonra `O<4 hane> (YORUM)`, sona `M30` yazar; alt programlarda `%` / `O....` / `M99` / `%` kullanır [6]. Syntec kılavuzunda `%`'nin zorunlu olduğu yazmıyor (bilinmiyor).
- O-numarası: Fusion postu program adını tam sayı ister (`programNameIsInteger = true`) [6]. Ahşap kontrolcüde ise dosya listesi `00001.nc`, `F_0001.nc` gibi serbest adlar gösteriyor [4]. Sonuç: dosya adı serbest, dosya içi `O` numarası isteğe bağlı görünüyor (makinede doğrula).
- Uzantı: ahşap kontrolcüde uzantı serbest. Yeni dosya varsayılan olarak uzantısız açılıyor; `.NC` istenirse elle yazılıyor. Dosya adı uzantı dahil en fazla 32 karakter [4]. Working list için uzantı ayarı zorunlu [4]. Laguna kılavuzu `.nc` dosyası kullanıyor [7].
- USB: AUTO > F2 Program > F8 File Manager > F4 File Transfer > F1 Import; dosya USB'den `NcTemp` klasörüne kopyalanıyor. NcTemp dönemsel olarak temizleniyor [7]. Ahşap kılavuzu da F2 Program > F8 (8 tuşlu) veya F4 (5 tuşlu) File Manager yolunu veriyor [4].
- Çift istasyon / ön-arka yüz: aynı parçanın iki dosyası ortak gövde + ön/son ek ile eşleştiriliyor (`00001_F.nc`, `00001_B.nc`, `F_0001.nc`) [4]. NittCam şimdilik bunu kullanmıyor; ileride ön/arka yüz çıktısı için not.
- N numaraları: isteğe bağlı. Fusion postu en fazla N8999 kullanıyor [6].
- Satır sonu, karakter kodlaması, satır uzunluğu, dosya boyutu sınırı: Syntec kaynaklarında **bilinmiyor**. Fusion postu ASCII kod sayfası kullanıyor [6]. Makro dosyaları için 60.000 bayt üstünde alarm verildiği bildiriliyor [8] (arama özeti, belge açılamadı). Bu sınır makro dosyaları içindir, düz ISO programlar için değil.

## 2. Başlangıç modal durumu ve güvenli giriş
- Varsayılan besleme modu G94 (mm/dak). G01'de F yoksa varsayılan F 1000 mm/dak. G94/G95 varsayılanı Pr3836 ile değişir [1].
- G00 hareket tipi Pr411'e bağlı: 0 = doğrusal enterpolasyon, 1 = her eksen kendi azami hızıyla (köpek bacağı yol) [1]. Post bunu bilemez; güvenli Z'ye önce ayrı satırda çıkmalı.
- Fusion postunun girişi: `G90 G94 G17 G49 G40 G80`, sonra ayrı satırda `G71` [6].
- Önerilen giriş: `G71` / `G90 G94 G17 G40 G49 G80` / `G54`.

## 3. Hareket
- G00/G01/G02/G03, G17/G18/G19 düzlemleri [1].
- IJK: başlangıçtan merkeze vektör, G90'da bile artımlı [1][3]. Kılavuz örneği: `G17 G90 G03 X1500 Y4000 I-3000 J-1000 F200` (noktasız, µm) [1].
- R: 180 derece ve altı için pozitif, 180-360 arası negatif R; tam daire (360 derece) yalnız IJK ile (`G02 I1000 F100`) [1][3].
- Helis: düzleme dik eksenle birlikte G02/G03 (`G17 G03 X0 Y1000. R1000. Z900. F600`) [1].
- G90.1/G91.1: listede yok [1][3]. IJK mutlak mod desteklenmiyor varsay.
- Yay toleransı alarmı: Syntec kaynağında eşik değeri bulunamadı (bilinmiyor). Fusion postu yayları en fazla 180 derece, R modunda 90 derece süpürüyor [6].
- Köşe/akıcılık: G61 tam duruş modu, G64 kesme modu (yavaşlamadan sonraki bloğa geçer), G09 tek blok tam duruş, G05/G05.1 yüksek hız/yol yumuşatma [1][3]. Post G64 yazmak zorunda değil.

## 4. Besleme ve spindle
- F: G94'te mm/dak [1]. Fusion postu F'yi noktalı yazıyor (`F1000.`) [6]; noktasız F'nin yorumu kaynakta açık değil, nokta yaz.
- S: devir/dak (G97). `S18000 M03` [1]. M03/M04/M05 standart [1]. Spindle çalıştırma kontrolcü tarafından yönetiliyor (VFD'nin PLC ile bağlanması makine üreticisine bağlı).
- Spindle hızlanma beklemesi için standart bir parametre kaynakta yok; post `G04` ile bekleme yazmalı.
- Dwell: `G04 X_` (noktalı = saniye, 0.001-9999.999 s; noktasız = ms) veya `G04 P_` (ms, nokta yasak) [1][3]. Kılavuzlar arasında fark: V8.20 `G04 P2.5` için "2 s" diyor [1], 2020 kılavuzu "2 ms" diyor [3]. İki durumda da noktalı P hatalı; post P'yi tam sayı ms yazmalı.
- M00 çalışınca spindle durur, ilerleme durur, soğutma kapanır [1]. M00 sonrası spindle'ı yeniden çalıştırmak ve beklemek gerekir.

## 5. Takım değişimi
- `T<n> M06`. M06 takım seçmez, T ile birlikte kullanılır [1]. ATC makrosunun ne yaptığı (Z'yi nereye çıkardığı, spindle'ı durdurup durdurmadığı) makine üreticisinin makrosuna bağlı.
- Fusion postu: `T1 M06`, sonra `S.. M03`, sonra `G43 Z.. H..` [6].
- Uzunluk telafisi: `G43 Z_ H_` (pozitif), `G44` (negatif), `G49` iptal; H = ofset numarası [1]. G28 ve G53 öncesi telafi iptal edilmeli [1].
- ATC olmayan makinede M06'nın ne yapacağı (alarm, duraklama veya yok sayma) PLC'ye bağlı: **makine üreticisine bağlı**. Manuel değişim için `M00` güvenli seçim; M00 spindle'ı durdurur [1].
- Z sıfırı: takım boyu operasyon ekranında girilir veya bir referans takım G54'e göre ayarlanıp diğerleri fark olarak girilir [1]. Ahşap kontrolcüde otomatik takım ölçümü (G37/G37.1, tool setting ekranı) var [1][4].

## 6. Koordinatlar
- G54..G59 ve G59.1..G59.9 = 15 iş koordinatı. Pr3229 ile iş koordinatları kapatılabiliyor [1]. `G54.1 P` yok [1][3].
- G53: makine koordinatı, tek blok, yalnız G90'da, önce telafiler iptal, önce referans dönüşü yapılmış olmalı [1].
- G28: ara nokta üzerinden G00 ile referansa döner (`G28 Z0.` yalnız Z), öncesinde takım telafisi iptal edilmeli [1]. G30 2./3./4. referans [1].
- G92 ve G52 de var [1]. Fusion postunda güvenli geri çekilme varsayılanı G28, seçenek G53 [6].

## 7. Yardımcı çıkışlar
- Standart: M08/M09 soğutma aç/kapa, M19 spindle konumlama [1]. Fusion postu flood için M08 kullanıyor [6].
- Vakum tabla, pop-up pim, toz emme davlumbazı, bölge vakumu: Syntec standart M listesinde yok [1]. PLC/makro ile makine üreticisi tanımlar: **makine üreticisine bağlı**. Makine profili bu kodları kullanıcıdan almalı.

## 8. Delik döngüleri ve alt programlar
- `G81 X Y Z R F K`, `G82` (dipte bekleme P), `G83 X Y Z R Q F K` (Q pozitif artımlı paso, geri çekilme payı d parametre 4002), `G73` hızlı gagalama, `G80` iptal, `G98/G99` başlangıç/R düzlemine dönüş [1].
- Uyarılar [1]: döngüden önce spindle'ı M koduyla çalıştır. Grup 01 kodu (G00/G01) ile G81 aynı blokta olmaz. Eksen hareketi olmayan blokta delme yapılmaz. G83'te P (dipte bekleme) saniye olarak geçiyor; ms/s birimini makinede doğrula.
- Alt program: `M98 P<program> H<sıra> L<tekrar>`, `M99` dönüş [1]. Makro çağrısı: `G65 P L <argümanlar>`, modal `G66/G67` [1].
- Makro dili: dosyanın ilk satırı `%@MACRO` ise dosya Syntec makro dili (Pascal benzeri; `IF/END_IF`, `GOTO`, `#` değişkenleri, satır sonunda `;`) olarak okunur, değilse normal ISO [5][8]. Uygulama kılavuzundaki örnek `% @MACRO` başlığı, `#1=#1046;` gibi `#` değişkenleri ve `//` yorumları kullanıyor [5]. `@` ile başlayan değişkenler için açılmış bir kaynak bulunamadı. NittCam postu makro dili kullanmamalı.

## 9. Yorumlar ve karakterler
- Fusion Syntec postu yorumları `( ... )` içinde, büyük harfle, yalnız `A-Z 0-9 . , = _ -` ve boşlukla, satırı 80 karakterle sınırlayarak yazıyor [6].
- Syntec kılavuzlarındaki örneklerde `//` satır sonu yorumu kullanılıyor (`G04 X2.5;//delay 2.5 sec`) ve parantezli satırlar da var [1][3]. `//` makro dosyalarında kesin geçerli [5]; düz ISO'da `//` desteği makinede doğrulanmalı.
- Türkçe karakter: kaynak yok. ASCII ile sınırla.

## 10. Bilinen tuzaklar
- G21 yazmak: Syntec belgelerine göre birim kodu G71; G21 Syntec'te başka anlam taşıyabilir veya alarm verebilir. Forumlarda "Fanuc postu çalışır, G20/G21 yerine G70/G71 yazın" deniyor [9] (forum, ikincil kaynak; arama özeti, belge açılamadı).
- Noktasız koordinat: `X100` yazan bir post 0.1 mm'ye gider (varsayılan ayarda) [1][5]. En tehlikeli tuzak bu.
- `G04 P5.0`: Mach3 tarzı saniye yazan bir post Syntec'te yanlış süre bekler (P ms ve nokta yasak) [1][3].
- M00 spindle'ı durdurur [1]. Manuel takım değişiminden sonra M03 + bekleme şart.
- Fusion forumunda 6MB için hazır post bulamayan kullanıcı raporları var [9] (forum, ikincil kaynak; arama özeti).
- Ahşap working list uzantı ayarı yanlışsa dosyalar listede görünmüyor [4].

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. 100x100 mm kare cep dış hattı (köşeleri R5 yay), tek takım, ATC yok, M00 ile takım onayı.
```
%
O0001 (NITTCAM SYNTEC TEST)
G71
G90 G94 G17 G40 G49 G80
G54
G0 Z50.
(TAKIM T1 D6 TAKILI MI)
M00
G0 Z50.
S18000 M03
G04 P5000
G0 X10. Y5.
G1 Z-3. F500.
G1 X100. F2000.
G3 X105. Y10. I0. J5.
G1 Y100.
G3 X100. Y105. I-5. J0.
G1 X10.
G3 X5. Y100. I0. J-5.
G1 Y10.
G3 X10. Y5. I5. J0.
G0 Z50.
M05
M30
%
```
Not: ATC'li makinede `M00` satırının yerine `T1 M06` ve `G43 Z50. H1` gelir.

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| program.prefix | `%` | [6] |
| program.start | `O0001 (AD)`, `G71`, `G90 G94 G17 G40 G49 G80`, `G54` | O numarası isteğe bağlı olabilir (doğrula) |
| program.end | `M05`, `M30` | |
| program.suffix | `%` | [6] |
| comments.style | `paren` | [6] |
| comments.asciiOnly | true, büyük harf | [6] |
| comments.maxLength | 80 | Fusion değeri [6], kesin sınır bilinmiyor |
| lineNumbers.enabled | false (isteğe bağlı, max 8999) | [6] |
| modal.words | `G71 G90 G94 G17 G40 G49 G80 G54` | G21 değil, G91.1 yok |
| toolChange.mode | `auto` (ATC'li), `manual` + `M00` (ATC'siz) | |
| toolChange.lengthOffset | `G43 Z.. H..` (yalnız ATC + takım tablosu varsa) | [1][6] |
| toolChange.pauseForFirstTool | true (manuel modda) | |
| spindle.on/off | `M03` / `M05`, speedPosition `before` (`S18000 M03`) | [6] |
| spindle.rpmDecimals | 0 | [6] |
| dwell.word / unit / decimals | `P` / `ms` / 0 | [1][3][6] |
| motion | G0/G1/G2/G3 | |
| motion.machineCoordinates | G53 izinli (telafi iptal edilmiş olarak) | [1] |
| decimals.xy/z/arc | 3, **her zaman nokta** | [1][5][6] |
| decimals.feed | 0, **nokta ile** (`F2000.`) | [6] |
| arcs.mode | `ijIncremental` | [1] |
| arcs.distanceModeWord | null | G91.1 yok |
| arcs.fullCircle | false (180 derece böl) | güvenli seçim |
| arcs.helical | true | [1] |
| arcs.maxSweepDeg | 180 | [6] |
| drill.cycles | `none` (ilk sürüm); sonra `g81`/`g83` | [1] |
| vacuum on/off | makine profilinden, varsayılan yok | makine üreticisine bağlı |
| file.extension | `.nc` | [4][6][7] |
| file.maxNameLength | 32 (uzantı dahil) | [4] |
| file.lineEnding | `crlf` (varsayım) | bilinmiyor |
| file.maxSizeBytes / onOversize | bilinmiyor | |

## 13. Makinede doğrulanması gerekenler
- `G21` kabul ediliyor mu, yoksa sadece `G71` mi?
- Pr3241 (decimal point type) bu makinede 0 mı? Noktasız `X10` 0.01 mm mi gidiyor? (Havada, küçük değerle dene.)
- Düz ISO dosyada `//` ve `( )` yorumları sorunsuz mu? Türkçe karakter ne yapıyor?
- `%` ve `O` satırı olmadan dosya açılıyor mu? CRLF/LF farkı var mı?
- ATC'siz makinede `M06` ne yapıyor? M00 sonrası spindle yeniden kalkıyor mu?
- Pr411 (G00 doğrusal mı, eksen bağımsız mı)?
- Vakum, pim ve toz emme M-kodları (üreticinin PLC listesi).
- Dosya boyutu sınırı ve NcTemp'ten büyük dosya çalıştırma (DNC/USB'den doğrudan çalıştırma var mı?).

## Kaynaklar
1. SYNTEC, Mill Machine Program Manual, Version 8.20, 2015/11/13. https://www.salecnc.com/manuals/CNC_Router/Syntec/Mill%20Programming%20Manual-EN.pdf (erişim 2026-11-23) [maker manual]
2. SYNTEC, Mill Machine Program Manual, Version 8.16, 2013/11/26. https://wiki.hsbne.org/_media/tools/woodshop/syntec-g-function.pdf (erişim 2026-11-23) [maker manual, çapraz kontrol]
3. SYNTEC, Mill Machine Program Manual (değişiklik 2020-07-31, dışa aktarım 2023-05-10). https://cdn1.npcdn.net/userfiles/24666/download/1692659063_ce3d8f7f007f060cc43b7e3b49afd925/Mill_Machine_Program_Manual.pdf (erişim 2026-11-23) [maker manual]
4. SYNTEC, 60WA/600WA/610WA-H/610WB-H Wood Operation Manual, 2023-05-10. https://syntecvietnam.com/wp-content/uploads/2023/12/60WA600WA610WA-H610WB-H-Wood-Operation-Manual.pdf (erişim 2026-11-23) [maker manual]
5. SYNTEC, SYNTEC CNC Application manual, Ver 10.0, 2006/08/10. https://servicetex.ru/wp-content/uploads/lib/cnc/SYNTEC/%D0%A0%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE%20%D0%BF%D0%BE%20%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D0%BD%D0%B5%D0%BD%D0%B8%D1%8E.pdf (erişim 2026-11-23) [maker manual]
6. Autodesk, Fusion post library, `syntec.cps` ("Generic SYNTEC Milling post", revizyon tarihi 2026-09-02). https://cam.autodesk.com/posts/posts/syntec.cps (erişim 2026-11-23) [CAM vendor]
7. Case Western Reserve Univ., "LAGUNA CNC ROUTER - How to load programs onto the controller via USB". https://sites.google.com/case.edu/lagunacncrouter/home/running-the-laguna-cnc-router/how-to-load-programs-onto-the-controller-via-usb (erişim 2026-11-23) [kullanıcı belgesi, ikincil]
8. Scribd, "Syntec Macro Development Tool Guide" (OpenCNC Macro Development Manual). https://www.scribd.com/document/760006844/Syntec-Macro-Development-Tool-Guide (erişim 2026-11-23) [maker manual kopyası; arama özeti, belge açılamadı]
9. Autodesk Fusion forum, "Syntec 6MB controller cps file help". https://forums.autodesk.com/t5/fusion-manufacture-forum/syntec-6mb-controller-cps-file-help/td-p/8430964 (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]

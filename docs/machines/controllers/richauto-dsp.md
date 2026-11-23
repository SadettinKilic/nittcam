# RichAuto DSP (Beijing RichAuto S&T / Beijing Ruizhitianhong)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: düşük-orta (üreticinin A11/A18 kullanıcı kılavuzları yalnızca menüleri ve ayar adlarını veriyor, G-code sözlüğü, dwell birimi ve IJK varsayılanı belgelenmemiş. Sözdizimi büyük ölçüde Autodesk Fusion'ın RichAuto postundan çıkarıldı. B57/B58 ATC kılavuzu bulunamadı).

## Özet (post yazacak kişi için)
- El terminali (DSP) dosyayı **USB bellekten (FAT16/FAT32)** doğrudan çalıştırır ya da 512 MB iç belleğe kopyalayıp oradan çalıştırır [1][2]. Standart G-code ve PLT okur [1][2].
- Okuma davranışı "Auto Pro Setup > G Code Setup" menüsünden ayarlanır. F, T, S, G54, G49 ve G40 için **Read/Ign (oku/yok say)** seçimi, yay merkezi için "AbsCntr Off/On", ayrıca CodeHead, Ignore Z ve ATC Spld seçenekleri var [2]. Fabrika varsayılanları kılavuzda yalnızca renkle (mavi) gösterilmiş, kopyalarda okunamıyor (bilinmiyor).
- Dosya başlatılırken operatör işlem hızını, boşta hızı, Z dalış oranını, hız oranını ve spindle kademesini terminalde girer [1]. F ve S "Ign" ise dosyadaki değerler hiç kullanılmaz [2].
- Spindle çoğunlukla **3 hatlı 8 kademe** (S1-S8) ile sürülür: Y1 aç/kapa, Y2-Y4 kademe bitleri [1][2]. `S18000` gibi bir devrin hangi kademeye eşlendiği bilinmiyor.
- Fusion RichAuto postu: `.nc`, ASCII, `%` ile başlar ve biter, yorumlar parantez içinde (en fazla 80 karakter), IJ **artımlı** ve her yayda yazılı, yaylar yalnızca XY düzleminde, `T# M6`, dwell `G4 P<saniye>`, G43 yok, delik döngüsü yok, sonda `M30` [4].
- Dwell birimi üretici belgesinde yok. Fusion saniye yazar [4]. Weihong'da P milisaniye olduğu için iki kontrolcü karıştırılmamalı.
- İş koordinatları terminalden seçilir (0 = makine, 1-9 = iş sistemleri) [1][2]. Makine koordinat sisteminde iş sıfırı ayarlanamaz [1][2]. Enerji kesintisinden sonra makine sıfırına dönüş gerekir [2].

## Sürümler / donanım
- A serisi el terminalleri: A11 (3 eksen) [2], A18 (4 eksen) [1]. A12, A15 ve A11E aynı A1X kılavuz ailesinde yer alır (arama özeti, belge açılamadı) [6]. B11/B15/B18 "AutoNow" ve B57/B58 (doğrusal ATC) modellerinin kılavuzları bu araştırmada açılamadı (bilinmiyor).
- Çin malı hobi, reklam ve ahşap router'larda (özellikle 6090/1325 tipi, step motorlu) çok yaygın. Türkiye'ye gelen ucuz router'larda NcStudio/NK105 ile birlikte en sık görülen kontrolcü.
- Sistem: el terminali + 50 pinli kablo + arayüz kartı. Bilgisayara USB kablo ile bağlanıp disk gibi görünebilir [1][2].
- Firmware güncellemesi `*.PKG` dosyasıyla USB'den yapılır [1][2]. Sürüm bilgisi menüde görünür (ör. A1.497) [1].

## 1. Program dosyası
- Biçimler: standart G-code ve PLT [1][2]. Üretici sayfaları uzantı listesi vermiyor. Fusion postu `.nc` yazar [4]. `.u00`, `.mmg` ve `.txt` desteği: bilinmiyor (kaynak bulunamadı). **Öneri: `.nc`.**
- USB: FAT16 veya FAT32 [1][2]. Dosya USB'den doğrudan çalıştırılabilir ya da "Operate File > Copy File" ile iç belleğe kopyalanabilir [1][2]. İşlem sırasında USB çıkarılmamalı [1]. Bilgisayarda "güvenli kaldır" yapılmadan çıkarılan USB'yi kontrolcü tanımayabilir [1].
- Dosya seçim ekranı bir seferde yalnız birkaç dosya gösterir [1]. Dosya adı uzunluğu ve Türkçe/Çince karakter kuralı: bilinmiyor. Kısa ve ASCII ad (8.3 uyumlu, ör. `PANO01.nc`) en güvenli seçim (doğrulanmadı).
- Başlangıç/son: Fusion postu ilk ve son satıra `%` yazar, sonda `M30` var [4]. G Code Setup'taki "CodeHead Skip/NoSkip" seçeneği dosya başlığının atlanmasıyla ilgili görünüyor, ama anlamı belgelenmemiş [2].
- Satır numarası zorunlu değil, Fusion postu varsayılan olarak yazmaz [4].
- Çalıştırmadan önce sistem kodu otomatik denetler. Operatör denetimi atlayabilir. Yalnız tam ve hatasız denetim hatırlanır [2]. Büyük dosyalarda başlangıç gecikmesi beklenebilir.
- Satır sonu, satır uzunluğu, dosya boyutu sınırı: bilinmiyor (iç bellek 512 MB [1]).

## 2. Başlangıç modal durumu ve güvenli giriş
- Modal varsayılanlar belgelenmemiş (bilinmiyor).
- Fusion postunun preamble'ı: `%`, program adı yorumu, `G90 G94`, `G17`, `G21` [4]. Ardından her operasyonda iş koordinatı (`G54` vb.) [4].
- G Code Setup'ta "Read G54/Ign G54", "Read G49/Ign G49", "Read G40/Ign G40" seçenekleri var [2]. Yani bu kodlar tanınır ama ayara göre yok sayılabilir.
- Önerilen preamble: `G90 G17 G21 G54` (Fusion'a yakın, `G94` isteğe bağlı). `G91.1` yazılmamalı. Desteklendiğine dair kaynak yok.

## 3. Hareket
- `G0/G1/G2/G3` desteklenir (Fusion postu bu kodları yazar) [4].
- Yay merkezi: G Code Setup "AbsCntr Off/On" ("Absolute center") [2]. Off'un artımlı IJ olduğu düşünülüyor, varsayılan bilinmiyor. Fusion postu her zaman **artımlı IJ** yazar, I ve J sıfır olsa bile [4]. Tam daireyi tek blokta IJ ile yazar [4].
- Fusion postunda R özelliği tanımlı değil, R'nin desteklendiğine dair kaynak yok. **IJ artımlı kullanılmalı.**
- Düzlem: Fusion postu yalnızca XY yaylarına izin verir [4]. Helisel yay izinli [4].
- En fazla 180° süpürme, en kısa kiriş 0.25 mm, yay yarıçapı 0.01-1000 mm [4]. 1000 mm üstü yaylar doğrusallaştırılır.
- "CirLmt" (A11'de 55.556) [2] ve A18'de "Circle Limit" (varsayılan 1000.000) [1] parametreleri var, anlamları belgelenmemiş (muhtemelen yay hız/yarıçap sınırı, doğrulanmadı).
- Bir Fusion forum başlığında RichAuto'da G2/G3 yönlerinin yanlış çıktığı ve bunun postla düzeltilip düzeltilemeyeceği sorulmuş, çözüm görünmüyor (forum, ikincil kaynak, arama özeti, belge açılamadı) [5]. Bu sorun AbsCntr ayarıyla ilgili olabilir.
- Look-ahead / G64: bilinmiyor. "Start Speed" (varsayılan 100 mm/dak) ve "acceleration" (varsayılan 800 mm/s²) parametreleri var [1].

## 4. Besleme ve spindle
- `F` mm/dak (Fusion `G94` + mm) [4]. G Code Setup "F Read/Ign" [2]. "Ign" ise terminaldeki işlem hızı (varsayılan "work speed" 6000, "fast speed" 3000 mm/dak) kullanılır [1].
- Çalışma sırasında hız oranı 0.1-1.0 arasında ayarlanabilir (gerçek hız = ayarlanan hız × oran) [1]. Oran 1.0'ı geçmez [1].
- Z dalış: "Fall scale" ayarı var. Z, "fall height" (varsayılan 5 mm) yüksekliğine indikten sonra hızlı hareket "fall scale" (varsayılan 0.2) ile yavaşlar [1][2].
- Spindle: "Spindle Line Count" (3 hat = 2³ = 8 durum) ve "Spindle Statue" [1]. Varsayılan "3-line 8-state", alternatif "1-line 2-state (On/Off)" [2]. Y1 aç/kapa, Y2-Y4 kademe [2]. Çalışırken kademe S1..S8 arasında değiştirilebilir [1][2].
- G Code Setup "S Read/Ign" ve "Spindle NTLLG/FORCE/INSTR" seçenekleri var, anlamları belgelenmemiş [2]. Fusion postu `S#### M3` yazar [4]. S değerinin kademeye nasıl çevrildiği bilinmiyor. Pratikte devri çoğu zaman inverter veya kademe belirler.
- "Spindle Delay" (ms): spindle açılışı ve kapanışı için bekleme. Dosya okunduktan sonra spindle'ın ne kadar sürede başlayacağını da belirler [1][2]. Spindle hızlanması için en güvenilir yol bu parametre.
- Dwell: üretici belgesinde yok (bilinmiyor). Fusion postu `G4 P<saniye>`, 3 ondalık yazar ("seconds - range 0.001-1000") [4].

## 5. Takım değişimi
- A11/A18 (ATC'siz): "Advanced processing > Tool changing" menüsü makineyi ayarlanan takım değiştirme konumuna götürür. Değişimden sonra iş sıfırına dönülür [1][2]. Z sıfırı takım sensörüyle (tuş kombinasyonu) yeniden bulunur. "C.A.D. Thickness" sensör kalınlığıdır ve yalnızca otomatik takım ölçümünde etkilidir [1].
- G Code Setup'ta "T Read/Ign" ve "ATC Spld Auto/None" [2]. ATC'siz modelde T'nin dosyada ne yaptığı (durur mu, yok sayar mı) bilinmiyor.
- Fusion postu her takımda `T# M6` yazar, `M0` yazmaz [4]. G43/H yazmaz [4].
- B57/B58: satıcı ilanlarında "doğrusal ATC kontrol sistemi" olarak geçiyor (arama özeti, belge açılamadı) [6]. Hangi kodla takım değiştirdiği (`T# M6` mı, yalnızca `T#` mı) bilinmiyor, kılavuz bulunamadı.
- Öneri: ATC'siz makinede tek takımlı dosya (`toolChange.mode = "none"`, takım başına bir dosya). Bu, RichAuto pratiğine en uygun ve en güvenli yol. `M0`'ın desteklendiği belgelenmemiş, Fusion postunda var [4].

## 6. Koordinatlar
- 9 iş koordinat sistemi var (aynı kılavuzda bir yerde "8" deniyor) [1][2]. Terminalde menü + rakam ile seçilir: 0 = makine, 1..9 = iş sistemleri [1][2]. G54..G59 ile hangi numaranın eşleştiği belgelenmemiş. G Code Setup "Read G54/Ign G54" [2].
- İş sıfırı yalnızca iş koordinat sisteminde ayarlanabilir. "İş sıfırı ayarlanamıyor" hatası çoğu zaman makine koordinatında kalındığı içindir [1][2].
- Açılışta "StrtHome Query/Auto/ZOnly/None" seçimine göre sıfıra dönüş istenir. Enerji kesintisinden sonra sıfıra dönüş zorunlu [2]. Koordinatlar kapanışta otomatik kaydedilir [1].
- "Beyond limit" hatası: makine sıfıra dönmemiş, iş sıfırı yumuşak limite çok yakın ya da dosyadaki sıfır noktası yanlış [1].
- `G53`/`G28`: Fusion postu G28 ve G53 seçeneklerini sunar ama varsayılanı "Clearance Height"tır, yani güvenli Z'ye iş koordinatında çıkar [4]. Kontrolcünün G53/G28 desteği belgelenmemiş. **NittCam G53 kullanmamalı.**
- İş bitince ne olacağı (iş sıfırına dön, sıfıra dön, belirli konuma git, yerinde kal, Z'yi kaldır) "Stop Statue" ile ayarlanır [1][2]. Güvenli yükseklik varsayılanı 40 mm [2].

## 7. Yardımcı çıkışlar
- Temel I/O kartında 8 giriş ve 8 çıkış var [1]. Çıkış 1-4 spindle aç/kapa ve kademe 1-3 olarak kullanılır [1]. Geriye soğutma, vakum ve yağlama için az çıkış kalır.
- Fusion postu soğutma için `M8` / `M9` yazar [4]. Kontrolcü "M kodlarını tanır, kullanıcı isteğine göre özel kod eklenebilir" [1][2]. Yani M8/M9 ya da vakum kodu makine üreticisine bağlı.
- Vakum/toz emme: belgelenmemiş. RichAuto makinelerde genelde elle açılır (doğrulanmadı). Öneri: makine profili yoksa vakum M kodu yazılmamalı.

## 8. Delik döngüleri ve alt programlar
- Fusion RichAuto postunda delik döngüsü yazılmaz, delme işlemleri G0/G1 hareketlerine açılır [4]. G81/G83 desteği belgelenmemiş (bilinmiyor). **`drill.cycles = "none"`.**
- Alt program (M98/M99): belgelenmemiş, kullanılmamalı.
- Kontrolcünün kendi dizi (array) işlevi var: satır, sütun, aralık ve ms cinsinden bekleme [1].

## 9. Yorumlar ve karakterler
- Fusion postu yorumları `(` `)` içinde yazar. İzin verilen karakterler `a-z 0-9 . , = _ -` ve boşluk, satır en fazla 80 karakter [4]. İki nokta (`:`) bile izinli listede değil [4].
- Üretici kılavuzu yorum sözdizimini belgelemiyor (bilinmiyor). Türkçe karakter: bilinmiyor, ASCII'ye çevrilmeli.
- Ekran dili Çince/İngilizce (A18'de birkaç dil daha) [1]. Türkçe yok. Dosya adı ve yorumlarda Türkçe karakter kullanılmamalı.

## 10. Bilinen tuzaklar
- F/S "Ign" seçiliyse dosyadaki hızlar uygulanmaz, terminaldeki değer kullanılır [1][2]. Ayrıca hız oranı 1.0'ı geçemez [1].
- Fall scale ayarı, hızlı Z inişini 5 mm'den sonra yavaşlatır [1]. Bu, postun dalış F'sinden bağımsızdır.
- Spindle S değeri kademeye eşlenir. 18000 devir yazmak 18000 devir garanti etmez [1][2].
- Yay yönü/merkezi sorunları kullanıcı raporlarında var (forum, ikincil kaynak, arama özeti) [5]. İlk iş havada (air cut) bir daire ve bir çeyrek yay denenmeli.
- USB düzgün çıkarılmazsa tanınmayabilir. İşlem sırasında USB çekilmemeli [1].
- Makine koordinatındayken iş sıfırı ayarlanamaz [1][2].
- 4. eksen (B581E) için ters zamanlı ilerlemede DeskProto'nun "1/hr" birimi gerekmiş (yapımcı ipucu) [3]. NittCam 3 eksen olduğu için yalnızca bilgi notu.

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. IJ artımlı varsayıldı. Dwell birimi saniye varsayıldı (Fusion [4]). Ms ise yalnızca kısa bir bekleme olur, tehlikeli değil. Asıl hızlanma süresi "Spindle Delay" parametresine bırakılmalı.
```
%
(NITTCAM ORNEK - DOGRULANMADI)
G90 G17 G21 G54
G0 Z20.000
M3 S18000
G4 P5.000
G0 X0.000 Y0.000
G1 Z-3.000 F600
G1 X90.000 Y0.000 F1500
G3 X100.000 Y10.000 I0.000 J10.000
G1 X100.000 Y100.000
G1 X0.000 Y100.000
G1 X0.000 Y0.000
G0 Z20.000
M5
M30
%
```

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| file.extension | `.nc` | [4]; diğer uzantılar bilinmiyor |
| file.maxNameLength | 8 (öneri, 8.3) | doğrulanmadı |
| file.lineEnding | `crlf` | doğrulanmadı |
| file.maxSizeBytes / onOversize | bilinmiyor / - | iç bellek 512 MB [1] |
| program.prefix / suffix | `%` / `%` | Fusion [4] |
| program.start | `G90 G17 G21 G54` | Fusion `G90 G94 G17 G21` [4] |
| program.end | `M5`, `M30` | [4] |
| comments.style | `paren` | [4] |
| comments.asciiOnly / maxLength | true / 78 | Fusion 80, sınırlı karakter kümesi [4] |
| lineNumbers.enabled | false | [4] |
| modal.words | G90 G17 G21 G54 | G40/G49 "Ign" olabilir [2] |
| toolChange.mode | `none` (takım başına dosya) | ATC'li B57/B58: muhtemelen `auto` `T# M6` (yalnızca Fusion [4]), doğrulanmadı |
| toolChange.lengthOffset | kapalı | Fusion G43 yazmaz [4] |
| toolChange.pauseForFirstTool | false | `none` modunda gereksiz |
| spindle.on / off / speedPosition | `M3` / `M5` / before (`S18000 M3`, Fusion sırası) | S kademeye eşlenir [2][4] |
| spindle.rpmDecimals | 0 | [4] |
| dwell.word / unit / decimals | `P` / `s` / 3 | yalnızca Fusion kaynaklı [4], makinede doğrula |
| motion.machineCoordinates | false | G53 belgelenmemiş |
| arcs.mode / distanceModeWord | `ijIncremental` / null | AbsCntr=Off varsayılır [2][4] |
| arcs.fullCircle / helical | false (ikiye böl) / true | Fusion tam daireye izin verir [4], güvenli taraf |
| arcs.maxSweepDeg | 180 | [4] |
| arcs.chordTolerance | 0.002 mm | Fusion toleransı [4] |
| decimals.xy / z / arc / feed | 3 / 3 / 3 / 1 | [4] |
| drill.cycles | `none` | [4] |
| vacuum on/off | yok (makine profili gelirse) | [1][2] |

## 13. Makinede doğrulanması gerekenler
- Model ve sürüm (Menu > Version View).
- G Code Setup ekranındaki tüm değerler: F, T, S, G54, G49, G40 Read/Ign; AbsCntr; Spindle NTLLG/FORCE/INSTR; CodeHead; Ignore Z; ATC Spld. Ekran fotoğrafı alınmalı.
- Yay testi: IJ artımlı ile çeyrek yay ve tam daire doğru yönde ve doğru yerde mi?
- `G4 P5.000` 5 saniye mi bekliyor? `G4` hiç tanınıyor mu?
- `S18000` hangi kademeyi seçiyor? Spindle Delay değeri ne?
- `%` satırları, parantez yorumu ve `M0` sorunsuz mu?
- Dosya adı: uzun ad, Türkçe karakter ve boşluklu ad listede görünüyor mu? USB FAT32 ve exFAT denemesi.
- G54 dosyada yazılıyken terminalde seçilen iş koordinatı (1..9) mı geçerli, G54 mü?
- Dosya bitince Stop Statue ayarı ne yapıyor?
- ATC modelde `T2 M6` davranışı ve takım boyu ölçümü.

## Kaynaklar
1. Beijing Ruizhitianhong (RichAuto), "Engraving machine motion control system A18 - Four axis mechanical carving User's manual", kopya: https://adef.xyz/r/4/41/Richauto-a18-manual.pdf (erişim 2026-11-23) [maker manual, third-party copy]
2. RichAuto S&T, "Engraving machine motion control system A11 - Three-axis mechanical carving User's manual", SlideShare kopyası: https://www.slideshare.net/slideshow/dsp-controller-a11-manual/56113711 ; aynı kılavuzun Suzhou Rico kopyası: https://www.slideshare.net/salcesmith/dsp-a11-handle-controller-operating-manual-ricocnc (erişim 2026-11-23) [maker manual, builder copy]
3. DeskProto, "Tips for RichAuto controllers": https://www.deskproto.com/support-tips-tricks/dp-tips-richauto.php (erişim 2026-11-23) [CAM vendor]
4. Autodesk Fusion post library, "RichAuto DSP" (richauto.cps, rev 44229): https://cam.autodesk.com/posts/download.php?name=richauto (erişim 2026-11-23) [CAM vendor]
5. Autodesk forum, "Post processor for RichAuto 11": https://forums.autodesk.com/t5/fusion-manufacture/post-processor-for-richauto-11/m-p/7623614 (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
6. RichAuto A1X kılavuz dizini (manualslib) ve B57 satıcı ilanı: https://www.manualslib.com/manual/1670936/Richauto-A1x.html , https://www.ebay.de/itm/126081097394 (erişim 2026-11-23) [builder/satıcı; arama özeti, belge açılamadı]

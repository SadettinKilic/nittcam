# Weihong NcStudio (Weihong / Shanghai Weihong Electronic Technology)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: orta (G-code sözdizimi üreticinin kendi programlama kılavuzundan [1], parametreler V8 ve NK105 kılavuzlarından [2][3]; ama M kodları, F/S okuma ve IJK modu makine üreticisinin parametre ayarına bağlı).

## Özet (post yazacak kişi için)
- **Dwell `G04 P` milisaniyedir**: `G04 P1000` = 1 s [1]. Mach3 goldenindeki `G4 P5.0` burada 5 ms olur. Delik döngülerinde de P ms ve ondalıksız [1]. Fusion NcStudio postu da `G4 P<ms>` yazar [5].
- **Yorum tek tırnak `'` ile başlar, satır sonuna kadar sürer** [1]. Kılavuzda parantez yorumu tanımlı değil. Fusion postu da `'` kullanır, satırı 80 karakterle ve sınırlı ASCII ile keser [5].
- **IJK modu G-code ile değil parametreyle seçilir.** V8'de N4063 "ArcIJKIncrementModeValid" (varsayılan true = artımlı) [2], NK105'te "Arc Increment" [3]. Kod listesinde `G90.1`/`G91.1` yok [1]. Parametreden bağımsız olmak için **`R` biçimi** en güvenli yol: pozitif R ≤180°, negatif R >180°, R ile tam daire yazılamaz [1]. Fusion postunun varsayılanı da R, en fazla 90° süpürme [5].
- M kodları makine üreticisi tarafından tanımlanır: her `Mnn`, `public.dat` içindeki `O(200+nn)` alt programını çağırır [1]. Yeni NcStudio'da NcConfig > MCodeConfig ekranında düzenlenir [4]. Bu yüzden vakum/toz/soğutma kodu makine profiline bağlı.
- `T` tek başına takım seçer. T ile takım arasındaki ilişkiyi makine üreticisi kurar [1]. V8'de "ToolReplacingPromptValid" varsayılanı false: takım değişim komutunda **durmaz, devam eder** [2]. Fusion postu `M6`'yı varsayılan olarak yazmaz [5]. Manuel değişim için `M00` gerekir (bkz. bölüm 5).
- Dosyadaki F ve S, "UseDefaultFeedrate / UseDefaultSpindleRev" (V8) veya "Ignore F Code / Ignore S Code" (NK105) parametreleri açıksa **yok sayılır** [2][3].
- `G00` bloğuna F yazılırsa G00 hızını değiştirir ve program boyunca modal kalır [1]. Post G0 satırına F yazmamalı.
- Program sonu `M30` veya `M02`. Başlangıçta `%` veya O numarası gerekmez [1][5]. Varsayılanlar G90, G17, G54, metrik [1].

## Sürümler / donanım
- **PC tabanlı NcStudio** (Windows yazılımı + PCI/PCIe kart): V5/V8 sürümleri PCIMC-63A/53B/53C kartlarla çalışır [2]. V10/V15 ve yeni "NcStudio Phoenix" (NC60A/NC65C endüstriyel PC + Lambda kontrolcü) de aynı aileden [4]. Programlama kılavuzu (R6, 2016-03) tüm NcStudio frezeleri için ortak [1].
- **NK105 G2/G3**: bütünleşik kutu ve el terminali (DSP benzeri). USB bellek ve "C disk" iç belleği var [3]. NK260/NK280/NK300 entegre kontrolcülerin kılavuzu bu araştırmada açılamadı (bilinmiyor). Aynı yorumlayıcı ailesinden oldukları varsayılabilir ama doğrulanmadı.
- Çin üretimi ahşap ve reklam router'larında (özellikle 1325 tipi, çoklu kafa/pnömatik değiştiricili makineler) çok yaygın. Türkiye'deki ithal router'ların önemli kısmında NcStudio veya NK105 bulunur.
- V10 kullanıcı kılavuzunun arşiv kopyası bozuk indi, okunamadı.

## 1. Program dosyası
- Desteklenen biçimler: ISO G-code, HP PLT, DXF, JDPaint ENG ve Weihong NCE [2]. NcStudio Phoenix program yöneticisi `.g`, `.eng`, `.dxf`, `.nc`, `.plt`, `.txt`, `.nce`, `.anc`, `.cnc`, `.tap` dosyalarını listeler [4]. NK105 dizi (array) işlevi metin tabanlı `txt`, `nc`, `u00` dosyalarında çalışır [3]. Yani `.u00` NK105'te tanınan bir metin uzantısı [3]. Fusion postu `.nc` yazar [5]. **Öneri: `.nc`.**
- Yeni program oluşturulduğunda varsayılan ad `Untitle1.nc` olur [2].
- Blok yapısı: `N.. G.. X.. F.. M.. S..`. N numaraları isteğe bağlı (kılavuz örnekleri N'li ve N'siz) [1]. Fusion postu varsayılan olarak N yazmaz [5].
- Başlangıç: `%` veya `O` gerekmez. `O` yalnızca alt program başlığıdır [1]. Fusion postu `%` yazmaz [5].
- Son: `M02` veya `M30` (M30: program sonu ve başa dönüş) [1]. NK105'te dizi dosyası üretilirken M30/M2/M1 otomatik silinir [3].
- Kodlama: Fusion postu `setCodePage("ascii")` kullanır [5]. Satır sonu (CRLF/LF), azami satır uzunluğu ve dosya boyutu sınırı: bilinmiyor. PC sürümü Windows olduğu için CRLF güvenli kabul edilir.
- Dosya adı kuralı (uzunluk, Türkçe karakter): bilinmiyor. NK105 klasörleri destekler, dosyalar USB'den iç belleğe ("C disk") kopyalanabilir. Büyük dosyalarda kopyalama ilerleme ekranı çıkar [3]. USB dosya sistemi (FAT16/FAT32) NK105 kılavuzunda belirtilmemiş (bilinmiyor).
- İşlem bitince makinenin davranışı (yerinde kal / sabit noktaya git / iş sıfırına dön) V8'de N4005 parametresiyle seçilir [2].

## 2. Başlangıç modal durumu ve güvenli giriş
- Varsayılanlar: `G90` [1], `G17` [1], `G54` [1], metrik (G21/G71) [1], ölçekleme kapalı `G50` [1].
- G-code ile IJK modu seçilemez (bkz. bölüm 3), bu yüzden preamble'da `G91.1` **yazılmamalı**. Kod listesinde yok [1], muhtemelen hata verir (doğrulanmadı).
- `G94` kod listesinde yok [1]. Fusion forumunda Fanuc postuyla G94 hatası alındığı bildirilmiş (forum, ikincil kaynak, arama özeti, belge açılamadı) [6]. Preamble'a `G94` yazılmamalı.
- Önerilen preamble: `G90 G17 G21 G40 G49 G54`. Hepsi kod listesinde var [1]. Fusion postu `G0 G17 G90` + `G21` yazar [5].

## 3. Hareket
- `G00` hızlı konumlama. Z hareketi varsa yorumlayıcı hareketi böler: Z yukarı gidiyorsa önce Z sonra düzlem, aşağı gidiyorsa önce düzlem sonra Z [1]. G00 hızı makine parametresinden gelir. G00 satırındaki `F` bu hızı programın geri kalanı için değiştirir [1].
- `G01` doğrusal, `G02` CW, `G03` CCW [1].
- Yay biçimleri: `G02 X_ Y_ R_` veya `G02 X_ Y_ I_ J_` [1]. R pozitifse yay ≤180°, negatifse >180° [1]. R ile tam daire yazılamaz, ikiye bölünmeli [1].
- IJK: "IJK artımlı modu" açıkken merkez başlangıç noktasına göre, kapalıyken **iş sıfırına göre** [1]. V8 N4063 varsayılanı true (artımlı) [2]. NK105'te "Arc Increment" parametresi aynı işi yapar [3]. Varsayılanı NK105 kılavuzunda okunamadı.
- Tam daire IJ ile yazılabilir (`G02 X0 Y0 I20 J0`) [1].
- Helis: yay satırına üçüncü eksen eklenerek yapılır [1]. Fusion postu helise izin verir ama helisel tam daireyi doğrusallaştırır [5].
- Yay yarıçap toleransı: NK105'te IJK ile hesaplanan iki yarıçap arasındaki fark ("ARadiuToleranc") ayarlanır, önerilen değer yaklaşık 0.01 mm [3]. Postta 3-4 ondalık yeterli.
- Look-ahead: NK105'te "Forward LookSeg" (ileri bakılan segment sayısı) ve yalnızca G3'te "Look Ahead Dis" var [3]. V8 "yüksek akıcılıklı hız bağlantı" algoritması kullanır [2]. `G64` kod listesinde yok [1].
- Fusion postu: `minimumChordLength` 0.25 mm, en fazla 180° süpürme, R modunda 90° [5].

## 4. Besleme ve spindle
- `F` birimi mm/dak. Panelden %0-120 override [1]. F modal [1].
- V8 N4034 "UseDefaultFeedrate" true ise dosyadaki F yok sayılır, N4032 varsayılan hız (varsayılan 1500 mm/dak) kullanılır [2]. NK105'te "Ignore F Code" ve "Ignore S Code" aynı işi yapar [3].
- Z dalış: V8 N4044/N4045 ayarlıysa Z aşağı hareketlerinde dosyadaki F yerine "Z_DownFeedrate" (varsayılan 500 mm/dak) kullanılabilir [2]. Postun dalış F'si makinede ezilebilir.
- `S` devir/dak, modal. Yalnızca hızı ayarlanabilen spindle'da etkili. Spindle kapalıyken de S değeri saklanır [1]. NK105 spindle'ı 8 kademeye kadar ("Spindle Gears") sürebilir ve açma/kapama gecikmesi ("ON/OFF Delay") vardır [3].
- `M03` CW, `M04` CCW, `M05` dur [1]. Bu kodların hangi çıkışı sürdüğü `public.dat` alt programlarıyla belirlenir. Kılavuz örneğinde M3 çıkışı açıp `G04` ile bekler [1].
- Dwell: `G04 P_`, P **milisaniye** [1]. Örnek: `G04 P2000` = 2 s [1]. Fusion postu saniyeyi ms'ye çevirip `G4 P` yazar, en az 1 ms [5]. `X` kelimesiyle dwell kılavuzda tanımlı değil (bilinmiyor).

## 5. Takım değişimi
- `T_` takım seçer. Takım ile T arasındaki ilişkiyi makine üreticisi belirler. Takım magazinli makinede T magazini döndürür. T ofsetleri bir sonraki takım değişimine kadar geçerli kalır [1].
- `M06` kılavuzun M tablosunda yok [1]. Fusion postunda "Output M6" seçeneği var ve varsayılanı kapalı [5]. M6 davranışı makine üreticisine bağlı.
- V8 N4068 "ToolReplacingPromptValid" varsayılan false: dosyada takım değişim komutu görülünce **durmadan devam eder**. True ise durur, operatöre takım değiştirmesini söyler [2]. NK105'te "ToolChangeTip" aynı işi yapar [3].
- NK105 pnömatik çoklu kafa (cylinder ATC): `T1`/`T2`/`T3` komutu ilgili silindiri ve spindle'ı açar, öncekini kapatır, Z'yi "Cut Up Pos"a kaldırır ve o takımın konum ofsetini uygular [3]. Türkiye'deki çok kafalı router'larda T'nin tek başına makineyi hareket ettirdiği unutulmamalı.
- Takım boyu: `G43 H_` / `G44 H_` / `G49`, H00-H07 [1]. ATC'siz makinede pratik: "First Cali" ile ilk takımda Z makine koordinatı kaydedilir, her takım değişiminden sonra "Second Cali" ile Z iş sıfırı geri getirilir [4][2].
- Sonuç: tek takım dışında güvenli yol, `toolChange.mode = "manual"`, `M05` + `M00` + yorum. `M00` kılavuzun M tablosunda var [1].

## 6. Koordinatlar
- `G54`-`G59` altı iş koordinat sistemi, varsayılan G54 [1].
- `G53` makine koordinat sistemi, yalnızca bulunduğu blokta geçerli (non-modal) [1].
- `G28 X_ Y_ Z_` ara noktadan referans noktasına döner [1]. Fusion postunun varsayılan güvenli geri çekilmesi G28 [5].
- `G92` iş koordinatını ayarlar ve **diğer iş sistemlerinin sıfırlarını da kaydırır** [1]. Postta kullanılmamalı.
- Makine sıfırına dönüş (homing) zorunluluğu: makine üreticisine bağlı. V8 N4051 "SafetyHeight" (iş sıfırına göre, varsayılan 10 mm) iş sıfırına dönüş ve kesinti sonrası devamda kullanılır [2].

## 7. Yardımcı çıkışlar
- Kılavuz tablosu: `M08` soğutma açık, `M09` kapalı [1]. Not: PDF tablosunun sütunları kaymış. Anlamlar Fanuc ile aynı sıradadır ve kılavuz örnekleri (`M03 S600 M08`, `M05 M09 M30`) bunu doğrular [1].
- Her `Mnn` kodu `public.dat` içindeki `O(200+nn)` alt programına bağlanır. M200-M599 ve G600-G999 aralıkları kullanıcı tanımlıdır. Örnekte M8, `M901 H24 P1` ile 24 numaralı çıkışı açar [1].
- NcStudio Phoenix'te ortak portlar Spindle, Cool, **Vacuum**, Lube. M kodları NcConfig > MCodeConfig'te makine parçasına göre atanır [4]. **Vakum/toz emme M kodu tamamen makine üreticisine bağlı.**
- `M901` doğrudan çıkış portu kontrolü [1]. Postta kullanmak riskli, makine profilinden gelmeli.

## 8. Delik döngüleri ve alt programlar
- Desteklenenler: `G73`, `G74`, `G81`, `G82`, `G83`, `G84`, `G85`, `G86`, `G89`. `G76`, `G87`, `G88` **desteklenmiyor** [1]. Ek olarak özel delik desenleri var: G34 daire, G35 çizgi, G36 yay, G37 dama tahtası [1].
- Biçim: `Gxx X_ Y_ Z_ R_ Q_ P_ F_ K_`. P ms ve ondalıksız, K tekrar sayısı (varsayılan 1). Z, R, Q, P modaldır [1]. `G98` başlangıç düzlemine, `G99` R düzlemine döner [1]. `G80` veya 01 grubundan bir G kodu döngüyü iptal eder [1].
- G73/G83 her gagadan sonra geri çekme miktarı V8 N4006 parametresinden gelir [2].
- Fusion postu `G98 G81 ...` yazar [5]. NittCam için öneri: önce `none` (açık G1 hareketleri), G81 sonra makinede doğrulanırsa.
- Alt programlar: `O` numarası ile başlar, `M17` ile biter. İçinde M30/M17 olmamalı, iç içe çağrı serbest [1]. Çağrı `M98`, `M99` alt program sonu [1]. NK105 dizi işlevinde G92, M17, G65 ve `#` değişkenleri yasak [3]. NittCam alt program kullanmamalı.

## 9. Yorumlar ve karakterler
- Yorum `'` ile başlar ve satır sonuna kadar sürer: `G00 X3 Y5 'hizli hareket` [1]. Kılavuz örneklerinde yorumlar kodla aynı satırda da kullanılır [1].
- Parantez `( )` yorumu kılavuzda tanımlı değil (bilinmiyor). Mach3 tarzı parantez yorumu yazılmamalı.
- Fusion postu: yorum öneki `'`, yalnızca `a-z 0-9 . , = _ - :` ve boşluk, satır en fazla 80 karakter [5]. Türkçe karakter: bilinmiyor, ASCII'ye çevrilmeli.
- Kılavuzda ifade/atama sözdizimi var (`#1=...`, `X=...`) [1]. Bu yüzden `=` ve `#` içeren metin yorum dışında yazılmamalı.

## 10. Bilinen tuzaklar
- Dwell ms: `G4 P5` = 5 ms, yani spindle hızlanmadan dalış yapılabilir [1]. Mach3 postu doğrudan kullanılmamalı.
- IJK parametresi kapalıysa artımlı IJ ile yazılmış yaylar yanlış yerde merkezlenir [1][2]. R biçimi bu riski kaldırır.
- F/S okuma kapalıysa ("UseDefaultFeedrate", "Ignore F Code") dosyadaki hızlar uygulanmaz [2][3]. Kullanıcı "hız değişmiyor" derse ilk bakılacak yer burası.
- Takım değişim uyarısı varsayılan kapalı: çok takımlı dosyada makine durmadan sonraki takımın yoluna geçebilir [2].
- G00 satırına F yazmak hızlı hareket hızını kalıcı değiştirir [1].
- `G92` diğer iş sistemlerinin sıfırlarını kaydırır [1].
- Fusion forumunda NK105/NK260 için hazır post bulunamadığı, Fanuc postunun G94 hatası verdiği ve topluluk postunda yay hataları görüldüğü yazılmış (forum, ikincil kaynak, arama özeti, belge açılamadı) [6].

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. Yaylar R biçiminde (IJK parametresinden bağımsız). Dwell ms.
```
'NITTCAM ORNEK - DOGRULANMADI
G90 G17 G21 G40 G49 G54
G0 Z20.000
M03 S18000
G04 P5000
G0 X0.000 Y0.000
G1 Z-3.000 F600
G1 X90.000 Y0.000 F1500
G3 X100.000 Y10.000 R10.000
G1 X100.000 Y100.000
G1 X0.000 Y100.000
G1 X0.000 Y0.000
G0 Z20.000
M05
M30
```

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| file.extension | `.nc` | [4][5]; NK105 `.u00` de okur [3] |
| file.lineEnding | `crlf` | doğrulanmadı |
| file.maxNameLength / maxSizeBytes | bilinmiyor / bilinmiyor | |
| program.prefix / suffix | yok | `%` gerekmez [1][5] |
| program.start | `G90 G17 G21 G40 G49 G54` | `G91.1` ve `G94` yazılmamalı [1] |
| program.end | `M05`, (`M09`), `M30` | [1] |
| comments.style | yeni bir stil gerekir: `apostrophe` (`'metin`) | NittCam'de şu an yok; ya bu stil eklenmeli ya da yorumlar kapatılmalı [1][5] |
| comments.asciiOnly / maxLength | true / 78 | Fusion 80 karakter [5] |
| lineNumbers.enabled | false | [5] |
| modal.words | G90 G17 G21 G40 G49 G54 | |
| toolChange.mode | `manual` (`M05` + `M00`) veya `none` | M6 makineye bağlı, uyarı varsayılan kapalı [1][2] |
| toolChange.lengthOffset | kapalı | router'da Second Cali ile Z [4] |
| toolChange.pauseForFirstTool | true | |
| spindle.on / off / speedPosition | `M03` / `M05` / after (`M03 S18000`) | S kademe/inverter bağlantısına bağlı [1][3] |
| spindle.rpmDecimals | 0 | |
| dwell.word / unit / decimals | `P` / `ms` / 0 | [1][5] |
| motion.machineCoordinates | `G53` izinli (non-modal) ama homing makineye bağlı | [1] |
| arcs.mode | `r` (öneri) | ijIncremental yalnızca N4063/Arc Increment doğrulanırsa [1][2] |
| arcs.distanceModeWord | null | G90.1/G91.1 yok [1] |
| arcs.fullCircle | false (R'de yasak) | [1] |
| arcs.helical | true | [1] |
| arcs.maxSweepDeg | 90 | Fusion R modu [5]; 180 da geçerli [1] |
| decimals.xy / z / arc / feed | 3 / 3 / 3 / 0 | Fusion 3 ondalık [5] |
| drill.cycles | `none` | G81 destekli [1], doğrulanınca açılabilir |
| vacuum on/off | makine profili | MCodeConfig'e bağlı [4] |

## 13. Makinede doğrulanması gerekenler
- Sürüm: PC NcStudio (V5/V8/V10/Phoenix) mi, NK105/NK260/NK300 mü?
- IJK artımlı parametresi (V8 N4063 / NK105 "Arc Increment") açık mı? R biçimli yay kabul ediliyor mu?
- `G04 P5000` gerçekten 5 s bekliyor mu?
- "UseDefaultFeedrate/SpindleRev" veya "Ignore F/S Code" kapalı mı? Z dalış hızı parametresi (N4044) devrede mi?
- `'` yorumu ve parantez yorumu nasıl işleniyor? Parantez hata veriyor mu?
- `M00` çalışıyor mu? `T2` tek başına ne yapıyor (çoklu kafa mı)? Takım değişim uyarısı açık mı?
- Vakum ve toz emme hangi M kodu (MCodeConfig / public.dat)?
- `M03 S18000` spindle hızını gerçekten ayarlıyor mu, yoksa kademe mi seçiyor?
- Dosya adı: uzun ad, Türkçe karakter ve boşluk NK105 listesinde görünüyor mu? USB FAT32 okunuyor mu?
- Satır sonu LF kabul ediliyor mu?

## Kaynaklar
1. Weihong, "NcStudio Programming Manual" R6 (2016-03). Resmi adres (artık 404): https://www.weihong.com.cn/en/uploads/soft/160816/1-160Q6112433.pdf ; okunan arşiv kopyası: http://web.archive.org/web/20240702025240/http://www.weihong.com.cn/en/uploads/soft/160816/1-160Q6112433.pdf (erişim 2026-11-23) [maker manual]
2. Weihong, "Engraving Machine's Motion Control System NcStudio-V8 User's Manual" (PCIMC-63A/53B/53C kartlar), kopya: https://wiki.tampere.hacklab.fi/_media/tyokaluja/nc_studio_menu.pdf (erişim 2026-11-23) [maker manual]
3. Weihong, "NK105G2/G3 CNC System Manufacturers' Manual" 7. baskı. Resmi adres (artık 404): https://www.weihong.com.cn/en/uploads/soft/160608/1-16060PUT0.pdf ; okunan arşiv kopyası: http://web.archive.org/web/20250325042222/https://www.weihong.com.cn/en/uploads/soft/160608/1-16060PUT0.pdf (erişim 2026-11-23) [maker manual]
4. Weihong, "Manufacturer's Manual of Ncstudio Phoenix Wood Three-Axis Engraving System" (2021-12-01, 1. sürüm), yapımcı kopyası: https://www.catekcnc.com/uploads/202411/03/0NpEEobKiLx5jdpfCcsQ.pdf (erişim 2026-11-23) [maker manual, builder copy]
5. Autodesk Fusion post library, "NcStudio Programming System" (ncstudio.cps, rev 44229, 2026-06-12): https://cam.autodesk.com/posts/download.php?name=ncstudio (erişim 2026-11-23) [CAM vendor]
6. Autodesk forum, "Post processor for Weihong NK105 (Solved!)" ve "Post processor NK260": https://forums.autodesk.com/t5/hsm-post-processor-forum/post-processor-for-weihong-nk105-solved/m-p/6091825 , https://forums.autodesk.com/t5/hsm-post-processor-forum/post-processor-nk260/td-p/7997404 (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]

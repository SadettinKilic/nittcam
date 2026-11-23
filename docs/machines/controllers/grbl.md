# GRBL 1.1 / grblHAL / FluidNC (gnea, grblHAL, bdring)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: yüksek (GRBL 1.1 ve grblHAL için kaynak kodu ve resmi wiki okundu); FluidNC için orta (wiki.fluidnc.com erişilemedi, bilgiler kaynak kodundan).

Bu dosya üç firmware'i birlikte anlatır. Ortak noktalar ana metinde, farklar "GRBL 1.1 / grblHAL / FluidNC" alt başlıklarında yazılıdır.

## Özet (post yazacak kişi için)
- Ark merkezi I/J her üç firmware'de de yalnız artımsal (incremental). `G91.1` kabul edilir ama bir şey yapmaz; `G90.1` reddedilir (`error:20`) [4][12][13].
- Dwell `G4 P<saniye>` (ondalıklı yazılabilir). Üçünde de P saniyedir, milisaniye değildir [5][10][13]. `G4 P5000` 83 dakika bekletir.
- Klasik GRBL'de `M6` yoktur: satır `error:20` verir ve iş durur. T kelimesi kabul edilir ama takım değiştirmez [4]. Manuel takım değişimi `M0` ile ya da her takım için ayrı dosya ile yapılmalıdır. grblHAL'de M6 `$341` ayarına bağlıdır [8][12]. FluidNC'de ATC veya M6 makrosu yoksa M6 duraklatmadan geçer [13].
- Klasik GRBL'de delik döngüsü (G81/G83 vb.) yoktur, `error:20` verir [4]. grblHAL'de G73/G81/G82/G83/G85/G86/G89 ve G98/G99 vardır [7]. FluidNC'de yoktur [13].
- Satır uzunluğu: GRBL 1.1'de 80 karakter (`LINE_BUFFER_SIZE`), grblHAL'de 256, FluidNC'de 255. Aşan satır çalıştırılmaz (`error:11`) [3][11][14]. Yorumlar bu sayıya girmez, çünkü ön ayrıştırıcı onları atar [3].
- Yorum olarak `( )` ve `;` (satır sonuna kadar) desteklenir [3]. `%` klasik GRBL'de desteklenmez, grblHAL ve FluidNC'de program başı/sonu işaretidir [3][12][13].
- `M7` (mist) klasik GRBL'de varsayılan olarak kapalıdır, `ENABLE_M7` ile derlenmek gerekir. `M8`/`M9` her zaman vardır [1][4]. Vakum için M8 güvenli seçimdir.
- Spindle `M3 S..` PWM ile sürülür. S değeri `$30`/`$31` aralığına göre ölçeklenir. Router'da `$32` (laser mode) 0 olmalıdır [2].

## Sürümler / donanım
- GRBL 1.1 (gnea/grbl, son sürüm 1.1h): Arduino Uno/Nano (ATmega328P) tabanlı hobi router ve lazerlerde çok yaygın. 3 eksen, PWM spindle [1].
- grblHAL: grbl 1.1f'nin 32-bit işlemcilere yeniden yazılmış hali (STM32, Teensy, ESP32, RP2040 vb.). Kanned cycle, takım değişimi, makro, SD kart gibi eklentileri vardır [7].
- FluidNC: ESP32 tabanlı, Grbl_Esp32'nin devamı. YAML ile ayarlanır, WiFi/WebUI ve SD kart vardır [13][15].
- Atölye router'larında yaygınlık: Türkiye'de küçük, hobi ve yarı-profesyonel router'larda GRBL tabanlı kartlar görülür. Endüstriyel panel router'larda nadirdir (bilinmiyor, kaynak yok).

## 1. Program dosyası
- Uzantı: firmware dosya uzantısıyla ilgilenmez, satırları sender gönderir. Uzantıyı sender belirler. `.nc` en güvenli seçim olarak öneriliyor (forum, ikincil kaynak) [18]. `.gcode`, `.tap`, `.ngc` gönderici yazılıma bağlıdır (bilinmiyor).
- Satır sonu: ön ayrıştırıcı boşluk ve kontrol karakterlerini (CR dahil) atar, satır sonu olarak LF/CR kabul edilir [3]. LF ya da CRLF ikisi de çalışır (kod okumasından çıkarım).
- Maksimum satır uzunluğu:
  - GRBL 1.1: `LINE_BUFFER_SIZE` = 80 (derleme ile değiştirilebilir). Taşan satır `error:11` verir, çalıştırılmaz [3][11].
  - grblHAL: 257 (256 karakter + sonlandırıcı) [11].
  - FluidNC: `maxLine = 255` [14].
  - Boşluklar ve yorumlar ön ayrıştırıcıda atıldığı için bu sayıya girmez [3]. Yine de seri RX tamponu 128 bayttır ve character-counting gönderimde sender bunu kullanır [6].
- N numaraları: kabul edilir. N değeri 1 ile 9.999.999 arasında olmalıdır, dışındaysa `error:27`. Aynı satırda iki N `error:25` verir [4][6]. Faydası yok, kapalı tutulmalı.
- `%`:
  - GRBL 1.1: desteklenmez. Kodda "NOT SUPPORTED" olarak işaretli ve filtrelenmez [3]. Tek başına `%` satırı büyük olasılıkla `error:1` (komut harfi yok) verir (kod okumasından çıkarım). Çoğu sender bu satırı süzer, ama post `%` yazmamalı.
  - grblHAL: `%` (`CMD_PROGRAM_DEMARCATION`) program başı/sonu işaretidir. Yanlış yerde kullanılırsa `Status_UnexpectedDemarcation` hatası verir [12].
  - FluidNC: tek başına `%` satırı iş (job/SD) kanalında program sınırı olarak işlenir ve çıkarılır. Seri kanalda bu işlem yapılmaz [13].
- Program sonu: `M2`/`M30` desteklenir [1][4].
- Blok silme `/`: desteklenmez, karakter yok sayılır [3].
- Küçük harf: büyük harfe çevrilir [3].
- Akış (streaming): bilgisayardaki sender satır satır gönderir. Basit gönder-yanıt (her satırda `ok`/`error` beklenir) en sağlam yöntemdir. Character-counting daha hızlıdır ama hata gelince tampondaki satırlar çalışmaya devam eder. Bu yüzden gönderimden önce `$C` (check mode) önerilir [6].
- FluidNC SD kart: dosya `$SD/Run=/dosya.nc` ile çalışır. Alarm durumunda `error:9` verir. Dosyadaki bir G-code hatası işi bitirir ve satır numarası raporlanır. Kılavuz, SD kütüphanesinin 4 GB'a kadar kartları desteklediğini söyler [15]. Dosya adı kuralları: bilinmiyor.

## 2. Başlangıç modal durumu ve güvenli giriş
- GRBL 1.1'in desteklediği modal kodlar: G0/G1/G2/G3, G38.x, G80, G54-G59, G17/G18/G19, G90/G91, G91.1, G93/G94, G20/G21, G40, G43.1, G49 [1].
- Mach3 postunun yazdığı `G21 G90 G91.1 G17 G40 G49 G54` satırındaki her kod GRBL 1.1 listesinde vardır [1]. Aynı satırda farklı modal gruplardan oldukları için çakışma (`error:21`) beklenmez (çıkarım, makinede doğrula).
- Önerilen giriş: `G21 G90 G94 G17 G54` (+ istenirse `G91.1 G40 G49`). `G28`/`G30` gibi hareket komutlarını açılış satırına koymayın, wiki bunu startup blokları için uyarır [1].
- Homing açıksa (`$22=1`) GRBL homing yapılana kadar G-code hareketlerini kilitler (alarm durumu, `error:9`) [2][5].

## 3. Hareket
- G0/G1/G2/G3 desteklenir [1]. G0 hızı eksen başına `$110`-`$112` (mm/dk) ile sınırlanır [2].
- Ark merkezi: I/J/K her zaman başlangıç noktasına göre artımsaldır. `G91.1` kabul edilir ama bir şey yapmaz. `G90.1` `error:20` verir. Bu GRBL 1.1 [4], grblHAL [12] ve FluidNC [13] için aynıdır.
- R ile ark: desteklenir. Negatif R 180 dereceden büyük yayı seçer. Hedef başlangıç noktasıyla aynıysa `error:33` verir, yani R ile tam daire yazılamaz [4].
- Tam daire: IJ biçiminde, başlangıç = bitiş ile yazılabilir (çıkarım; R biçiminde mümkün değil [4]). NittCam zaten yayları 180 derecede böldüğü için risk düşük.
- Helis (G2/G3 + Z): desteklenir, G2/G3 düzlem dışı eksen alabilir (LinuxCNC/NIST uyumu; GRBL kodunda düzlem dışı eksen doğrusal hareket eder, çıkarım).
- Ark hata kontrolü: başlangıç ve bitiş yarıçapları arasındaki fark 0.005 mm'yi aşarsa VE (0.5 mm'yi veya yarıçapın %0.1'ini aşarsa) `error:33` verir [4]. Pratikte ark merkezini 3-4 ondalıkla yazmak yeterlidir.
- Yaylar firmware içinde doğru parçalarına bölünür. Kiriş toleransı `$12` (varsayılan 0.002 mm) [2][5].
- G64 benzeri yol modu: GRBL 1.1'de yok. Planlayıcı look-ahead yapar, köşe hızı junction deviation `$11` ile belirlenir (bilgi [2] sayfasında, ayrıntı alınmadı). grblHAL `G61` destekler [7].
- `G53` yalnız G0 veya G1 aktifken çalışır, değilse `error:30` [4][5].

## 4. Besleme ve spindle
- F: G94'te mm/dk (G21). F tanımlanmadan G1/G2/G3 `error:22` verir [5].
- Spindle: `M3`/`M4`/`M5` ve `S`. S değeri PWM'e ölçeklenir. `$30` en yüksek devir (en yüksek PWM), `$31` en düşük devirdir. Daha yüksek S `$30`'a kırpılır [2].
- `$32` laser mode: açıkken S değişikliğinde hareket durmaz ve spindle beklemesi olmaz. Router'da 0 olmalıdır [2].
- Spin-up: GRBL spindle'ın devrini beklemez. Post `M3 S..` sonrasına `G4 P<saniye>` koymalıdır (genel pratik, sayısal öneri yok).
- Dwell: `G4 P<saniye>`. P zorunludur.
  - GRBL 1.1: `mc_dwell(float seconds)`, açıklaması "dwell in seconds" [10].
  - grblHAL: `mc_dwell(float seconds)` [16].
  - FluidNC: P değeri 1000 ile çarpılıp milisaniyeye çevrilir, yani girdi saniyedir [13].
  - Mach3 postunun `G4 P5.0` çıktısı bu üç firmware'de 5 saniye bekler.

## 5. Takım değişimi
### GRBL 1.1
- `M6` M-kodu listesinde yoktur ve `error:20` (unsupported command) verir. T kelimesi okunur ve saklanır (en fazla 255), ama hiçbir hareket ya da duraklama yapmaz [4].
- Sender'lar M6'yı kendileri işleyebilir. CNCjs 1.9.11 ve üstü M6'da programı duraklatır ve takım değiştirme makrosu çalıştırabilir (WCS ya da `G43.1` TLO ile) [17]. Bu sender'a bağlıdır, firmware'e değil.
- Post önerisi: `toolChange.mode = "manual"` (M6 yazma; `M5`, güvenli Z, `M0` ve yorum) ya da `"none"` (takım başına ayrı dosya). Z sıfırını kullanıcı yeniden alır.
- Takım boyu: yalnız dinamik `G43.1 Z..` ve `G49` vardır. `G43 H..` yoktur [1].
### grblHAL
- `M6` ve `M61` desteklenir [7]. Davranışı `$341` ayarı belirler [8]:
  - `0` normal: program kendisi spindle'ı durdurmalı ve değişim konumuna gitmelidir. M6, stream duraklatmayı destekleyen bir sürücü ve sender yoksa `Status_GcodeUnsupportedCommand` verebilir (kod okumasından çıkarım [12]).
  - `1` manuel touch-off: spindle ve soğutmayı durdurur, homing konumuna gider. Değişimden sonra `$TPW` ile ya da elle touch-off yapılır, cycle start ile devam eder.
  - `2`: 1 ile aynı, ayrıca G59.3 konumuna gider.
  - `3`: G59.3'teki takım sensörüyle otomatik touch-off.
  - `4`: takım numarasını kaydeder, M6'yı yok sayar.
  - 1-4 modları, protokol eklentisini destekleyen bir sender ister (ioSender, WebUI) [8].
- `G43 H`, `G43.2`, `G43.1` ve takım tablosu (`N_TOOLS`, varsayılan 0, en fazla 32) derleme ayarına bağlıdır [7][11].
### FluidNC
- M6 kabul edilir. Seçilen takım farklıysa önce hareketin bitmesini bekler, sonra spindle'ın `tool_change()` metodunu çağırır. Spindle için ATC ya da M6 makrosu tanımlıysa değişimi o yapar. Tanımlı değilse yalnız takım numarası güncellenir ve hiçbir duraklama olmaz [13].
- Sonuç: ATC'siz FluidNC'de M6 sessizce geçer. Manuel değişim için post `M0` yazmalıdır. Bir forum kullanıcısı FluidNC'nin takım değiştirme kodlarını yok saydığını bildiriyor (forum, ikincil kaynak) [19].

## 6. Koordinatlar
- `G54`-`G59` desteklenir, varsayılan G54. Ofset `G10 L2 P..` ya da `G10 L20 P..` ile yazılır [1]. `G59.1`-`G59.3` klasik GRBL'de yoktur (`error:29`) [5]. grblHAL'de vardır [7].
- `G53`: G0/G1 ile makine koordinatında hareket. Satırdaki eksen kelimelerine ofset uygulanmaz. G4/G10/G28/G30/G92 ile aynı satırda olamaz [4].
- `G28`/`G30`: önce verilen ara noktaya (ofsetli), sonra `G28.1`/`G30.1` ile kaydedilmiş konuma gider. İkinci harekette yalnız satırda adı geçen eksenler hareket eder. Eksen kelimesi yoksa doğrudan kayıtlı konuma gider [4]. Kayıtlı konum makineye özel olduğu için post `G28` yerine `G53 G0 Z..` kullanmalı.
- Homing: `$22=1` ise homing yapılmadan G-code kilitlidir [2]. Soft limit (`$20=1`) homing ve `$130`-`$132` (mm cinsinden en fazla hareket) ister [2]. Hard limit `$21` limit anahtarında hemen durdurur ve alarm verir [2].
- `$130`-`$132` yalnız soft limit için kullanılır [2]. Post tarafında iş parçası sınırı kontrolüne aday bilgi.

## 7. Yardımcı çıkışlar
- GRBL 1.1: `M7` yalnız `ENABLE_M7` ile derlenmişse vardır, varsayılan kapalıdır [1][4]. `M8` flood ve `M9` her ikisini kapatır [4]. `M56` (park override) derleme seçeneğidir [4].
- Vakum/toz emme için standart kod yok. Kartta M8 çıkışı bir röleye bağlanıyorsa vakum için `M8`/`M9` en güvenli seçimdir (makine üreticisine bağlı).
- grblHAL: M7/M8/M9 ve `M62`-`M68` dijital/analog çıkışları (sayı sürücüye bağlı) [7].
- FluidNC: M7/M8/M9 ve `M62`-`M68` kabul edilir [13]. Pinler YAML config'te tanımlanır (ayrıntı bilinmiyor, wiki erişilemedi).

## 8. Delik döngüleri ve alt programlar
- GRBL 1.1: G81-G89 yoktur, `error:20` [4]. Post G1 ile açık delme yazmalı (`drill.cycles = "none"`).
- grblHAL: G73, G81, G82, G83, G85, G86, G89, G98, G99 [7]. G87/G88 yok [12]. G82/G89 bekleme P'si de `mc_dwell` üzerinden saniye olarak işler [12][16]. G83 Q pozitif olmalıdır [12]. Alt program: `M98`/`M99`, O-kelimeleri ve `G65` makro çağrısı, makro/SD eklentisi gerektirir [7][12].
- FluidNC: G81-G89 yok, `error:20` [13]. O-kelimesi içeren satırlar akış kontrolüne gider (ayrıntı bilinmiyor) [13].

## 9. Yorumlar ve karakterler
- `(...)` parantez yorumu: `)` ya da satır sonunda biter. `;` satır sonuna kadar yorumdur (LinuxCNC kuralı) [3].
- Yorumlar ve boşluklar arabelleğe alınmadan atılır, satır uzunluğuna sayılmaz [3].
- ASCII dışı karakterler: yorum içindeyse atılır. Yorum dışında `error:1`/`error:2` beklenir (kod okumasından çıkarım). UTF-8 Türkçe harf çok baytlı olduğu için sender'ın tampon hesabını etkiler. Öneri: yalnız ASCII.
- Sayılar: ondalık ayırıcı nokta. Bozuk sayı `error:2` verir [5].
- Aynı satırda iki kez aynı kelime (örn. iki F) `error:25` verir [5].

## 10. Bilinen tuzaklar
- `M6` klasik GRBL'de iş durdurur (`error:20`) [4][5]. CAM postlarında en sık görülen hata budur.
- `G4 P5000` milisaniye sanılırsa 83 dakika bekler [10].
- `G90.1` (absolute IJ) yazan postlar GRBL'de `error:20` alır [4].
- `G81`/`G83` yazan postlar klasik GRBL ve FluidNC'de `error:20` alır [4][13].
- Hatalı ark merkezi `error:33` verir [4][5]. Az ondalıkla yuvarlanmış I/J küçük yarıçaplı yaylarda bu hatayı tetikleyebilir.
- 80 karakteri aşan satır `error:11` verir [5][11]. Uzun yorumlar sayılmaz ama çok eksenli ve çok ondalıklı satırlarda dikkat.
- Character-counting gönderimde bir hatadan sonra tampondaki satırlar çalışmaya devam eder [6].
- FluidNC'de M6 sessizce geçer, makine duraklamaz [13][19].
- Hata kodları (CAM çıktısında sık görülenler) [5]:
  - `error:1` komut harfi yok
  - `error:2` bozuk sayı biçimi (virgül, boş değer)
  - `error:9` alarm/jog durumunda G-code kilitli
  - `error:11` satır çok uzun
  - `error:20` desteklenmeyen komut (M6, G81, G90.1, G64...)
  - `error:21` aynı modal gruptan iki komut
  - `error:22` F tanımsız
  - `error:24` aynı satırda eksen kelimesi isteyen iki komut
  - `error:25` tekrar eden kelime
  - `error:30` G53 G0/G1 dışında
  - `error:33` geçersiz hedef (ark merkezi tutarsız)
  - `error:34` geçersiz ark yarıçapı
  - `error:36` kullanılmayan değer kelimesi
  - `error:38` takım numarası 255'ten büyük

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. 100x100 mm kare, bir köşe R10 yay, 3 mm derinlik. Üç firmware'de de aynı yazılır.
```
(NITTCAM GRBL TEST - DOGRULANMADI)
G21 G90 G91.1 G17 G40 G49 G54 G94
G0 Z10.000
M8
M3 S18000
G4 P5
G0 X0.000 Y0.000
G1 Z-3.000 F300
G1 X100.000 Y0.000 F1500
G1 X100.000 Y90.000
G3 X90.000 Y100.000 I-10.000 J0.000
G1 X0.000 Y100.000
G1 X0.000 Y0.000
G0 Z10.000
M5
M9
M30
```

## 12. Post için ayar önerisi
| Alan | GRBL 1.1 | grblHAL | FluidNC |
|---|---|---|---|
| file.extension | `.nc` (sender'a bağlı) | `.nc` | `.nc` (SD için de) |
| file.lineEnding | `lf` (CRLF de çalışır, çıkarım) | `lf` | `lf` |
| file.maxSizeBytes / onOversize | sınırsız (stream), null | null | SD 4 GB'a kadar kart [15] |
| program.prefix / suffix | `%` yazma | `%` isteğe bağlı, yazmamak güvenli | `%` yazmamak güvenli |
| program.end | `M30` | `M30` | `M30` |
| comments.style | `paren` | `paren` | `paren` |
| comments.asciiOnly | true | true | true |
| comments.maxLength | 70 öneri (yorum sayılmasa da sender güvenliği; belirsiz) | 120 | 120 |
| lineNumbers.enabled | false | false | false |
| modal.words | `G21 G90 G91.1 G17 G40 G49 G54 G94` | aynı | aynı |
| toolChange.mode | `manual` (M6 yazma, `M0`) veya `none` | `manual` (`$341`'e bağlı; M0 güvenli) | `manual` (`M0`, M6 duraklatmaz) |
| toolChange.manualStop | `M0` | `M0` | `M0` |
| toolChange.lengthOffset | yok (`G43 H` desteklenmez) | yok (derlemeye bağlı) | yok |
| spindle.on / speedPosition | `M3`, `after` (`M3 S18000`) | aynı | aynı |
| spindle.rpmDecimals | 0 | 0 | 0 |
| dwell.word / unit / decimals | `P` / `s` / 1 | `P` / `s` / 1 | `P` / `s` / 1 |
| motion.machineCoordinates | true (yalnız `G53 G0 Z..`) | true | true (çıkarım) |
| decimals.xy / z / arc / feed | 3 / 3 / 3 / 0 (80 karakter için 4 yerine 3 öner) | 4 / 4 / 4 / 0 | 4 / 4 / 4 / 0 |
| arcs.mode / distanceModeWord | `ijIncremental` / `G91.1` (no-op) veya null | aynı | aynı |
| arcs.fullCircle | false (öneri) | false | false |
| arcs.helical | true (çıkarım) | true | true |
| arcs.maxSweepDeg | 180 | 180 | 180 |
| drill.cycles | `none` | `g81`/`g83` mümkün, `none` öneri | `none` |
| vacuum on/off | `M8`/`M9` (M7 derlemeye bağlı) | `M8`/`M9` veya `M64 P..`/`M65 P..` | `M8`/`M9` |

Belirsiz: comments.maxLength (firmware sınırı yok, sender'a bağlı), decimals (80 karakter sınırı için 3 yeterli mi), helical arcs.

## 13. Makinede doğrulanması gerekenler
- Kullanılan sender (UGS, CNCjs, Candle, gSender, ioSender) `%`, `M6` ve yorumları nasıl işliyor? Sender filtreliyorsa firmware hiç görmeyebilir.
- `G21 G90 G91.1 G17 G40 G49 G54 G94` satırı tek satırda hatasız kabul ediliyor mu?
- `M8` çıkışı gerçekten vakuma bağlı mı? (makine üreticisine bağlı)
- `$32=0` mı? `$30` gerçek spindle devriyle eşleşiyor mu?
- Kart GRBL 1.1 mi, grblHAL mı, FluidNC mi? (`$I` ile sürüm sorgusu.)
- grblHAL'de `$341` değeri ve M6'nın sender'la davranışı.
- FluidNC'de M6'nın gerçekten duraklamadığı ve `M0`'ın beklediği.
- Uzun satırlarda (`error:11`) sınır, 3 ondalıkla.

## Kaynaklar
1. Grbl v1.1 Commands. https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands (erişim 2026-11-23) [maker wiki]
2. Grbl v1.1 Configuration. https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration (erişim 2026-11-23) [maker wiki]
3. gnea/grbl kaynak kodu, protocol.h ve protocol.c (LINE_BUFFER_SIZE, yorum/%/blok silme işleme). https://raw.githubusercontent.com/gnea/grbl/master/grbl/protocol.h , https://raw.githubusercontent.com/gnea/grbl/master/grbl/protocol.c (erişim 2026-11-23) [maker source]
4. gnea/grbl kaynak kodu, gcode.c (M-kod listesi, M6, T, G4, ark kontrolü, G53, G28/G30, N). https://raw.githubusercontent.com/gnea/grbl/master/grbl/gcode.c (erişim 2026-11-23) [maker source]
5. Grbl hata kodları CSV. https://raw.githubusercontent.com/gnea/grbl/master/doc/csv/error_codes_en_US.csv (erişim 2026-11-23) [maker doc]
6. Grbl v1.1 Interface. https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface (erişim 2026-11-23) [maker wiki]
7. grblHAL core README. https://github.com/grblHAL/core (erişim 2026-11-23) [maker doc]
8. grblHAL wiki, Manual, semi automatic and automatic tool change. https://github.com/grblHAL/core/wiki/Manual,-semi-automatic-and-automatic-tool-change (erişim 2026-11-23) [maker wiki]
9. (numara kullanılmadı; grblHAL M6 ve G90.1 için bkz. 12)
10. gnea/grbl kaynak kodu, motion_control.c (`mc_dwell(float seconds)`, `mc_arc`). https://raw.githubusercontent.com/gnea/grbl/master/grbl/motion_control.c (erişim 2026-11-23) [maker source]
11. grblHAL kaynak kodu, protocol.h (`LINE_BUFFER_SIZE 257`) ve config.h (`DEFAULT_TOOLCHANGE_MODE 0`, `N_TOOLS`). https://raw.githubusercontent.com/grblHAL/core/master/protocol.h , https://raw.githubusercontent.com/grblHAL/core/master/config.h (erişim 2026-11-23) [maker source]
12. grblHAL kaynak kodu, gcode.c (G90.1 reddi, canned cycle, M6, `%`, M98/M99) ve grbl.h (`CMD_PROGRAM_DEMARCATION '%'`). https://raw.githubusercontent.com/grblHAL/core/master/gcode.c , https://raw.githubusercontent.com/grblHAL/core/master/grbl.h (erişim 2026-11-23) [maker source]
13. FluidNC kaynak kodu, GCode.cpp (M-kodları, M6, G90.1, canned cycle yok, G4 P*1000, `%`). https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/GCode.cpp (erişim 2026-11-23) [maker source]
14. FluidNC kaynak kodu, Channel.h (`maxLine = 255`). https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/Channel.h (erişim 2026-11-23) [maker source]
15. FluidNC eski GitHub wiki, SD Card sayfası (arşiv sürümü; resmi wiki wiki.fluidnc.com'a taşındı, erişim denemesi bağlantı reddiyle başarısız oldu). https://github.com/bdring/FluidNC/wiki/SD-Card/999289810ea417800eef99ac8c477aa16e43e341 (erişim 2026-11-23) [maker wiki, eski]
16. grblHAL kaynak kodu, motion_control.c (`mc_dwell(float seconds)`, canned cycle dwell). https://raw.githubusercontent.com/grblHAL/core/master/motion_control.c (erişim 2026-11-23) [maker source]
17. CNCjs wiki, Tool Change. https://github.com/cncjs/cncjs/wiki/Tool-Change (erişim 2026-11-23) [sender doc]
18. Carbide 3D Community, "Opening Files In UGCS" (arama özeti, belge açılamadı). https://community.carbide3d.com/t/opening-files-in-ugcs/14629 (erişim 2026-11-23) [forum, ikincil kaynak]
19. V1 Engineering forum, "Tool Change /(M06)" (arama özeti, belge açılamadı). https://forum.v1e.com/t/tool-change-m06/41944 (erişim 2026-11-23) [forum, ikincil kaynak]

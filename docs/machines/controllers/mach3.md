# Mach3 (ArtSoft / Newfangled Solutions)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: orta (G-code davranışı üreticinin kendi kılavuzundan [1][2]; ama varsayılanlar profile/kuruluma bağlı, kılavuz bazı yerlerde kendisiyle çelişiyor, birkaç ayar adı yalnız forum/arama özetinden).

## Özet (post yazacak kişi için)
- Mach3 bir Windows PC yazılımıdır; davranışın büyük kısmı (dwell birimi, IJ modu, M6 tepkisi, M7/M8 çıkışları, program sonu sıfırlamaları) kullanıcının profilindeki ayarlara bağlıdır. Post, ayardan bağımsız olmak için modları **kodda açıkça** yazmalı [1][2].
- `G4 P` birimi Config > General Config'teki "G04 Dwell in milliseconds" kutusuna bağlı: işaretsizse saniye, işaretliyse milisaniye [1][2]. Yaygın kurulum saniye (Fusion Mach3 postu da varsayılan saniye yazar) [8][9].
- IJ modu (Absolute/Incremental) profilde ayarlanır ve varsayılanı kaynaklarda net değil; Mach3 kodda `G90.1` / `G91.1` kabul eder, en güvenlisi preamble'a `G91.1` yazmak [2][8][13].
- Merkez biçimli yaylarda başlangıç ve bitişin merkeze uzaklığı en fazla 0.002 mm (0.0002 inch) farklı olabilir, aşılırsa hata [2].
- M6 varsayılan olarak yok sayılır (General Config "Ignore Tool Change"); T kelimesi takımı değiştirmez [2][6]. Manuel değişim için `M0` (koşulsuz dur) ayardan bağımsızdır.
- Soğutma: `M7` mist, `M8` flood, `M9` hepsi kapalı (kılavuz tablosu, Fusion postu) [2][8]; ama kılavuzun metin kısmı ters yazıyor. Hangi fiziksel çıkışın açılacağı Spindle Setup / Ports & Pins eşlemesine bağlı, yani "vakum = M7" tamamen makine kurulumuna bağlı [1][14].
- Satır en fazla 256 karakter, N ve O numaraları 0-99999 [2]. Demo sürüm 500 satırda durur [3].
- Mach4'te `G4 P` ondalık noktasız yazılırsa **milisaniye** sayılır; Mach4 için dwell her zaman noktalı yazılmalı (bkz. Mach4 farkları) [7].

## Sürümler / donanım
- Mach3 Mill (Mach3 R3.x, son yaygın sürüm R3.043.066), ArtSoft USA / Newfangled Solutions. Kılavuz "Using Mach3 Mill" rev 1.84 [1]. Geliştirme Mach4'e kaydı; Mach3 bakımda ama hobi ve Çin malı router'larda (paralel port, USB/Ethernet motion kartları: UC100, CSMIO, ESS, çeşitli USB kartlar) hâlâ çok yaygın. Kart eklentileri (plugin) bazı davranışları değiştirebilir: makine üreticisine bağlı.
- Bu not Mill profilini kapsar (Turn/Plasma değil).

## 1. Program dosyası
- Uzantı: G-code düz metindir; dosya File > Load G-Code ile standart Windows açma diyaloğundan yüklenir [1]. Diyalog filtresi varsayılan olarak `.tap` gösterir, "All files" ile `.txt`/`.nc` da açılabilir (forum, ikincil kaynak, arama özeti) [10]. Fusion'ın Mach3 postu `.tap` yazar [8]. Öneri: `.tap`.
- Kılavuz: Notepad'de kaydederken "All Files" seçilmezse dosya `.txt` olur; dosyayı USB/disket yerine sabit diskten çalıştırın ve dosya salt okunur olmasın [1].
- Satır uzunluğu en fazla 256 karakter [2]. `N` satır numaraları ve `O` etiketleri 0-99999 (en fazla 5 hane) [2]. N numarası zorunlu değil.
- `%` ile başlayan satır yorum sayılır [2], yani dosya başı/sonu `%` zararsız ama gerekli değil.
- Program sonu: `M2` veya `M30`; `M30` dosyayı başa sarar ("rewind") [2]. İkisinin de etkileri (ofset silme, G92.1, spindle/soğutma kapatma vb.) Config > General Config "Program end or M30 or Rewind" seçeneklerine bağlı [1][2].
- Satır sonu: Windows yazılımı, CRLF güvenli; LF'nin reddedildiğine dair kaynak bulunamadı (bilinmiyor).
- Boyut: lisanslı sürümde 10.000.000 satır, demo sürümde Mill için 500 satır sınırı; demoda "Set Next Line" ve "Run From Here" kapalı [3].
- Dosya adı kuralı: belgelenmiş özel bir kural yok (bilinmiyor); Windows dosya adı geçerli.

## 2. Başlangıç modal durumu ve güvenli giriş
- Açılış modları Config > General Config'teki "Initial State" grubundan gelir: Motion mode (Constant Velocity = G64 / Exact Stop = G61), Distance mode (Abs G90 / Inc G91), Active plane (G17/G18/G19), I/J Mode (Inc/Absolute) ve bir "Initialization String"; "Use Init on ALL 'Resets'" ile reset/E-stop sonrası tekrar uygulanır [1]. Kılavuz, yanlış IJ ayarının daire sorunlarının en yaygın nedeni olduğunu söyler [1].
- Mach3 modları kendiliğinden (özellikle sürüm yükseltmeden sonra) değişmiş bulunabilir (forum, ikincil kaynak) [5]. Bu yüzden post her dosyada modları yazmalı.
- Önerilen preamble: `G21 G90 G91.1 G17 G40 G49 G54` (+ isteğe bağlı `G94`). Tüm kelimeler Mach3 sözlüğünde var: G40 [2], G49 [2], G91.1 [2], G54 [2]. Fusion Mach3 postu da `G90 G94 G91.1 G40 G49 G17` + `G21` yazar [8].

## 3. Hareket
- `G0`, `G1`, `G2` (CW), `G3` (CCW) [2].
- Merkez biçimi (I/J): Incremental IJ modunda I/J başlangıca göre ofset, Absolute IJ modunda gerçek koordinat [2]. `G90.1` mutlak IJ, `G91.1` artımlı IJ seçer (Mach3 kılavuzu bölüm 10.7.26, rev 1.84) [2]. Kılavuz "muhtemelen Incremental en iyisidir" der [2]. Fabrika varsayılanı kaynaklarda çelişkili (bazı forum yazıları Incremental, bazıları Absolute diyor) (forum, ikincil kaynak, arama özeti) [13].
- Yay toleransı: merkez biçimde başlangıç-merkez ve bitiş-merkez uzaklığı 0.002 mm'den (0.0002 inch) fazla farklıysa hata [2]. Tipik mesaj "Radius to end of arc differs from radius to start" (kullanıcı raporları, arama özeti) [13].
- Tam daire: merkez biçiminde bitiş noktası başlangıca eşit olabilir (tam daire) [2]. `R` biçiminde bitiş = başlangıç hata; neredeyse tam daire ve yarım daire R ile yazılması kötü uygulama [2]. Pozitif R = 180 derece veya daha az, negatif R = 180-359.999 derece [2].
- Helis: yay sırasında Z değişirse helisel hareket yapılır [2].
- CV modu: `G64` sabit hız (köşeleri hafif yuvarlar), `G61` exact stop [2]. Ekranda (Config > General Config değil, Settings/Ekran) "CV Mode / Angular Limit": açı limitinden keskin köşeler CV modunda da exact stop gibi işlenir [1].
- Minimum segment / look-ahead: kılavuzda post için sayısal bir alt sınır bulunamadı (bilinmiyor). Look-ahead satır sayısı General Config'te ayarlanır (sayısal varsayılan doğrulanmadı).

## 4. Besleme ve spindle
- `F`: Feed Mode ayarına göre birim/dakika veya birim/devir; uzunluk birimi G20/G21'e göre [2]. `G93` ters zaman, `G94` birim/dakika [2].
- Pratik tavan: her eksenin Config > Motor Tuning "Velocity" değeri (birim/dakika) ve "Accel" (birim/sn²) eksen hızını sınırlar; azami velocity çekirdek frekansı ve adım/birim ile sınırlıdır (ör. 25 kHz ve 2000 adım/birimde 750 birim/dk) [1]. Komut edilen F'nin bu hızın üstünde gerçekleşmediğine dair kullanıcı raporları var (forum, ikincil kaynak, arama özeti) [15]. Post için: F tavanı makine profilinden alınmalı.
- `S`: negatif S hata; `S0` izinli [2]. PWM veya Step/Dir spindle'da S hızı ayarlar; sadece röle (aç/kapa) spindle'da hız kasnak/inverterden gelir ve S yalnız gösterge değeridir [2].
- `M3` CW, `M4` CCW, `M5` dur [2]. Spindle çıkışları Config > Spindle Setup'ta: "Relay Control" (M3/M4 için Output #, "Disable Spindle Relays" ile kapatılır), "Motor Control" ("Use Spindle Motor Output", "PWM Control" veya "Step/Dir Motor"; PWM, Spindle Step pinini kullanır, "PWMBase Freq") [1]. Spindle Setup'ta başlatma/durdurma gecikmeleri (saniye) de tanımlanabilir [1]; bu ayar M3 sonrası bekleme yapar ama varlığı makineye bağlı, post yine kendi dwell'ini yazmalı.
- Dwell: `G4 P~`; birim General Config'teki kutuya göre saniye veya milisaniye [1][2]. Kılavuz: kutu işaretliyken `G4 P5000` 5 saniye, işaretsizken aynı satır 1 saat 23 dk 20 sn bekler [1]. Negatif P hata [2]. Fabrika varsayılanının saniye (kutu işaretsiz) olduğu yönünde kullanıcı ve CAM postu kanıtı var [8][9], ama makinede kontrol edilmeli.
- Satır içi yürütme sırası: yorum, feed mode, F, S, T, M6/makro, spindle on/off, soğutma, override, dwell, düzlem, birim, ... , hareket, stop [2]. Yani `M3 S18000` aynı satırda doğru sırada işler.

## 5. Takım değişimi
- `T` kelimesi sadece takım seçer; otomatik değiştirici olsa bile T takımı değiştirmez, ofset de uygulamaz [2]. T 0-255 [2].
- `M6`: M6Start makrosunu çağırır, Cycle Start'ı bekler, sonra M6End'i çalıştırır [2]. Config > General Config "Tool Change" seçenekleri: Ignore Tool Change / Stop Spindle, Wait for Cycle Start / Auto Tool Changer (Auto seçiliyken M6Start/M6End Cycle Start beklemeden çalışır) [1][4]. "Ignore" seçiliyse M6 etkisizdir [2].
- Varsayılan: Mach3 tool change'leri yok sayar ("Ignore") [6]. Stok M6Start.m1s yalnızca seçili takımı aktif takım yapar (forum, ikincil kaynak, arama özeti) [11]; yani güvenli bir park/Z kaldırma yapmaz.
- `M0`: koşulsuz program durdurma; `M1`: yalnız Optional Stop açıksa durur; Cycle Start ile sonraki satırdan devam [2]. Ekrandaki Opt Stop düğmesi M1 davranışını değiştirir (forum) [4].
- Takım boyu: `G43 H~` takım tablosundan uygular, `G49` iptal [2]. Router'larda takım boyu genelde operatörün yeni takımda Z'yi yeniden sıfırlamasıyla çözülür (forum) [4]; G43 kullanımı makine kurulumuna bağlı.
- Sonuç: tek tip ve güvenli yol, `toolChange.mode = "manual"` ile `M5` + `M0` (+ parantez mesajı); M6'ya güvenmek kullanıcının ayarına bağlı.

## 6. Koordinatlar
- `G54`-`G59` ilk altı iş ofseti, `G59 P~` diğerleri (kılavuz 254/255 diye çelişkili sayı veriyor), `G59 P0` mutlak makine sistemi [2].
- `G53` yalnız bulunduğu satırda geçerli, `G0` veya `G1` ile kullanılmalı, kesici yarıçap telafisi açıkken hata [2]. Makine koordinatları ancak makine referanslanmışsa (Ref All Home) anlamlı; referanssız makinede G53 Z hedefi bilinmez (makineye bağlı).
- `G28` / `G30`: ev konumu 5161-5166 parametrelerinden; önce programlanan ara noktaya gider [2]. `G28.1` eksenleri home anahtarına referanslar [2]. G28 konumu Config > Homing/Limits'te tanımlanır ve mutlak, G20/G21 birimindedir [1].
- Safe Z: Config > Safe_Z Setup; homing ve takım değişiminde kullanılan, kelepçelerden açık Z [1]. General Config'te "Use Safe_Z" makine referanslanmadıysa işaretsiz bırakılmalı [1]. Safe Z'nin makine mi iş koordinatı mı olduğu bir "Machine Coordinates" kutusuyla seçilir (arama özeti) [12].
- Soft limitler: Config > Homing/Limits'te eksen başına -999999..+999999, "Slow Zone" ile; ekrandaki Software Limits düğmesiyle açılır [1]. Soft limit anlamlı olması için referanslama gerekir.

## 7. Yardımcı çıkışlar
- `M7`, `M8` aynı modal grupta ve aynı anda açık olabilir; `M9` ikisini birlikte kapatır [2].
- Hangisi mist hangisi flood: Mach3 kılavuzu çelişkili. M-code tablosu (Şekil 10.7) `M7` mist / `M8` flood der; 10.8.4 metni tersini yazar [2]. Kurulum kılavuzu bölüm 5.3.6.1 da yazım hatası içeriyor [1]. Fusion Mach3 postu `M7` mist / `M8` flood / `M9` off kullanır [8]; Mach4 de aynı [7]. Pratikte belirleyici olan Spindle Setup'taki "Flood Mist Control" grubunun Mist (M7) ve Flood (M8) için seçtiği Output # numarasıdır; bu grup "Disable Flood/Mist Relays" ile kapatılabilir [1][14].
- Çıkış numaraları (Output #1..#6) Config > Ports & Pins > Output Signals sekmesinde pin/porta eşlenir [1].
- Vakum / toz emme: Mach3'te standart M kodu yok; ya M7/M8 çıkışlarından birine bağlanır ya da kullanıcı makrosu (M100+ / .m1s) ile yapılır: makine üreticisine bağlı.

## 8. Delik döngüleri ve alt programlar
- Desteklenen döngüler: G73, G81, G82, G83, G84, G85-G89; G80 iptal; G98/G99 dönüş seviyesi [2]. G73 için Q pozitif olmalı [2].
- Alt programlar: `O` etiketleri ve `M98`/`M99` var (kılavuz bölüm 10.8.x; detay bu araştırmada okunamadı); makrolar `M` + .m1s dosyaları [2].
- Öneri: NittCam ilk sürümde döngü kullanmasın (`drill.cycles = "none"`), G81 makinede doğrulandıktan sonra açılabilir.

## 9. Yorumlar ve karakterler
- Parantez içi yorum; iç içe olamaz [2]. `(MSG,...)` ile başlayan yorum operatöre mesaj olarak gösterilir [2]. `//` satır sonuna kadar yorum [2]. `%` ile başlayan satır yorum [2].
- Noktalı virgül (`;`) yorumu Mach3 kılavuzunda belgelenmemiş: kullanmayın.
- Türkçe / ASCII dışı karakterler: kaynak yok (bilinmiyor). ASCII-only önerilir; Fusion postu da yorumları büyük harfe çevirip izinli karakter setine filtreler ve 80 karakterle sınırlar [8].

## 10. Bilinen tuzaklar
- IJ modu profile göre değişir; yanlış ayar dev veya yanlış yerde daireler üretir (forum, ikincil kaynak) [13][5]. Çözüm: kodda `G91.1`.
- Dwell ms kutusu işaretliyse `G4 P5` yalnızca 5 ms bekler, spindle tam devire çıkmadan dalış olur [1].
- "Ignore Tool Change" varsayılanında `T2 M6` makineyi durdurmaz; yanlış takımla kesime devam edilir [6][4].
- Demo sürüm 500 satırda durur; kullanıcı lisanssız ise "dosya yarıda kaldı" diye görünür [3].
- Program sonu seçenekleri G92 ofsetlerini silebilir, konum beklenmedik yere kayabilir [1].
- F değeri Motor Tuning velocity'nin üstündeyse gerçek hız düşük kalır (forum, ikincil kaynak) [15].

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. (Dwell birimi saniye varsayılmıştır.)
```
(NITTCAM ORNEK - DOGRULANMADI)
G21 G90 G91.1 G17 G40 G49 G54
G0 Z20.000
M3 S18000
G4 P5.0
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
```

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| file.extension | `.tap` | [8][10] |
| file.lineEnding | `crlf` | Windows; LF de muhtemelen çalışır (doğrulanmadı) |
| file.maxSizeBytes / onOversize | yok / - | lisanslıda 10M satır [3] |
| program.start | `G21 G90 G91.1 G17 G40 G49 G54` | [2][8] |
| program.end | `M5`, `M9` (soğutma varsa), `M30` | M30 rewind [2] |
| comments.style | `paren` | [2] |
| comments.asciiOnly / maxLength | true / 120 | satır 256 sınırı [2] |
| lineNumbers.enabled | false (açılırsa max 99999) | [2] |
| modal.words | G21 G90 G91.1 G17 G40 G49 G54 | |
| toolChange.mode | `manual` (`M5` + `M0`) | M6 varsayılan ignore [6] |
| toolChange.lengthOffset | kapalı | router'da Z yeniden sıfırlanır (makineye bağlı) |
| toolChange.pauseForFirstTool | true | |
| spindle.on / off / speedPosition | `M3` / `M5` / after (`M3 S18000`) | S sadece PWM/StepDir'de etkili [2] |
| dwell.word / unit / decimals | `P` / `s` / 1 | ms kutusuna bağlı, makinede kontrol [1] |
| motion.machineCoordinates | izinli ama yalnız referanslanmış makinede | [2] |
| arcs.mode / distanceModeWord | `ijIncremental` / `G91.1` | [2] |
| arcs.fullCircle / helical | true / true (dikkatli) | [2]; ikiye bölmek daha güvenli |
| arcs.maxSweepDeg | 180 | Fusion varsayılanı [8] |
| decimals.xy/z/arc | 4 | 0.002 mm tolerans için yeterli [2] |
| drill.cycles | `none` | G81/G83 destekli ama doğrulanmadı [2] |
| vacuum on/off | makine profili (M7 veya M8 / M9) | eşlemeye bağlı [1] |

## 13. Makinede doğrulanması gerekenler
- General Config: "G04 Dwell in milliseconds" kutusu işaretli mi?
- General Config: IJ Mode ayarı ve `G91.1` satırının kabulü (Mach3 sürüm numarası, Help > About).
- Tool Change seçeneği (Ignore / Stop Spindle Wait / Auto) ve M6Start.m1s içeriği.
- Spindle Setup: M7/M8 hangi Output #, bu çıkışa ne bağlı (mist, vakum, toz emme)? "Disable Flood/Mist Relays" işaretsiz mi?
- Spindle kontrolü PWM/Step-Dir mi, yoksa röle + inverter potansiyometresi mi (S etkili mi)?
- Motor Tuning velocity (X/Y/Z) değerleri: postun azami F'si.
- Makine homing anahtarlı mı; G53 ve Safe Z güvenilir mi?
- Lisanslı mı (başlıkta "Demo" yazmamalı)?
- Program sonu (M30) seçenekleri hangi ofsetleri siliyor?

## Mach4 farkları
- `G4 P`: ondalık noktasız P **milisaniye** (`G4 P5` = 5 ms), noktalı P saniye (`G4 P5.` = 5 s) [7]. Golden'daki `G4 P5.0` Mach4'te de 5 sn olur; noktasız yazmak tehlikeli.
- Arc Center Mode (Mach3'teki IJ Mode) Mach4 yapılandırmasının General sekmesinde; `G90.1`/`G91.1` kodda da geçerli [7].
- `M6`: T aynı blokta veya önceden verilmiş olmalı; davranış m6 makrosuna (Lua) bağlı [7].
- `M7` mist, `M8` flood, `M9` hepsi kapalı (net) [7].
- `M0` hareketi ve spindle'ı durdurur; `M1` optional stop [7].
- `M30` sona erer, başa sarar ve varsayılanları (G54, G17, G90 vb.) sıfırlar; `M2` sarmaz, sonraki Cycle Start M2'den sonraki bloktan devam eder [7].
- İş ofsetleri: `G54.1 P1`-`P248`; eski `G59 P7` = `G54.1 P1` [7].
- Alt programlar: aynı dosyada `O####` + `M98 P####`, ya da Mach4\Subroutines klasöründe uzantısız `O####` dosyası; `M99` ana programda başa sarar [7].
- Döngüler G73-G89, G98/G99; G74, G76, G84.2/3, G87 kontrol yapılandırmasına bağlı [7].
- Kaynak bir yapımcı (MachMotion) belgesi; resmi Newfangled "Mill GCode Programming" PDF'i bu araştırmada metin olarak açılamadı.

## Kaynaklar
1. ArtSoft/Newfangled, "Using Mach3 Mill" rev 1.84. Resmi: https://www.machsupport.com/ftp/Docs/Mach3Mill_1.84.pdf ; metin SlideShare kopyasından okundu: https://www.slideshare.net/slideshow/mach3-mill-184/46667351 (erişim 2026-11-23) [maker manual]
2. ArtSoft, Mach3 "G and M-code Reference" (Using Mach3 Mill bölüm 10, rev 1.84-A2), SlideShare kopyası: https://www.slideshare.net/slideshow/mach3-g-code-language-reference/46667341 (erişim 2026-11-23) [maker manual]
3. Mach Support forum, Mach3 demo sınırları (Brett, topic 24552): https://www.machsupport.com/forum/index.php/topic,24552.msg173628.html (erişim 2026-11-23) [maker forum]
4. Mach Support forum, tool change / M1 tartışması (topic 14172): https://www.machsupport.com/forum/index.php/topic,14172.0.html (erişim 2026-11-23) [forum, ikincil kaynak]
5. Mach Support forum, modların sürüm yükseltmede değişmesi (topic 6339): https://www.machsupport.com/forum/index.php/topic,6339.0.html (erişim 2026-11-23) [forum, ikincil kaynak]
6. MachMotion support, "What do I need to do to enable automatic tool changes": https://support.machmotion.com/books/documentation-artsoft/page/what-do-i-need-to-do-to-enable-automatic-tool-changes (erişim 2026-11-23) [builder]
7. MachMotion, "Mach4 G-Code and M-Code Reference": https://support.machmotion.com/books/software/page/mach4-g-code-and-m-code-reference/revisions/10758 (erişim 2026-11-23) [builder]
8. Autodesk Fusion post library, Mach3Mill post: https://cam.autodesk.com/posts/post.php?name=mach3mill (erişim 2026-11-23) [CAM vendor]
9. Langmuir Systems forum, "Mach3 Pierce Delay Issue": https://forum.langmuirsystems.com/t/mach3-pierce-delay-issue/3542/9 (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
10. MyCNCUK forum t-13591, Mach3 yükleme filtresi: https://www.mycncuk.com/archive/index.php/t-13591.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
11. MyCNCUK forum t-3993, "Mach3 Tool Change Position" (stok M6Start.m1s): https://www.mycncuk.com/archive/index.php/t-3993.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
12. MyCNCUK forum t-13597 ve Scribd kılavuz kopyası (Safe Z Machine Coordinates kutusu): https://www.mycncuk.com/archive/index.php/t-13597.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
13. IndustryArena forum, "IJ mode absolute": https://en.industryarena.com/forum/ij-mode-absolute--131522.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
14. CS-Lab CSMIO/IP-M kullanım kılavuzu s.42 (Mach3 Spindle Setup, Flood Mist Control): https://manualshive.com/en/manual/cs-lab/csmio-ip-m/2692495?page=42 (erişim 2026-11-23) [builder; arama özeti, belge açılamadı]
15. IndustryArena forum, "Mach 3 feedrates do not match commanded rate": https://en.industryarena.com/forum/mach-3-feedrates-do-not-match-commanded-rate--405850.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]

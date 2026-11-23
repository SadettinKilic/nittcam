# Controller araştırması (post processor'lar için)

> Durum: masa başı araştırma, 2026-11-23. Hiçbir bilgi makinede doğrulanmadı. Kaynaklar her dosyanın sonunda (başlık, URL, erişim tarihi).
> Kılavuz metni repoya kopyalanmadı; bilgiler kendi cümlelerimizle yazıldı ve belgelere bağlantı verildi.
> Bir bilgi bilinmiyorsa veya makine üreticisine bağlıysa dosyalarda öyle yazıyor. Forum ve arama özetleri ikincil kaynak olarak işaretli.

## Dosyalar
| Dosya | Kapsam |
| --- | --- |
| [mach3.md](mach3.md) | Mach3 (ArtSoft), sonda Mach4 farkları |
| [mach3-saha-kontrol.md](mach3-saha-kontrol.md) | Sahibin Mach3 saha testi için tek sayfa ayar kontrol listesi |
| [weihong-ncstudio.md](weihong-ncstudio.md) | Weihong NcStudio V5/V8, NK105, NK260/NK280/NK300 |
| [richauto-dsp.md](richauto-dsp.md) | RichAuto DSP A11/A12/A15/A18, B serisi |
| [syntec.md](syntec.md) | Syntec 6MB/60W/21MA/63WA (ATC router) |
| [lnc.md](lnc.md) | LNC MW ahşap serisi |
| [delta-nc.md](delta-nc.md) | Delta NC300/NC311 (kısa, belge az) |
| [grbl.md](grbl.md) | GRBL 1.1, grblHAL, FluidNC |
| [ddcs.md](ddcs.md) | DDCS V3.1, V4.1, Expert |
| [masso-uccnc-eding.md](masso-uccnc-eding.md) | Masso G3, UCCNC, Eding CNC (kısa) |
| [panel-lines-osai-tpa.md](panel-lines-osai-tpa.md) | Biesse, SCM, Homag, TPA, Osai: G-code yerine kendi formatları (kısa) |

## Özet tablo
"Dwell" sütunu bir saniyelik beklemenin nasıl yazıldığını gösterir. Postumuzun bugünkü `G4 P5.0` satırı **saniye** varsayar; milisaniye kullanan controller'da 5 ms bekler.

| Controller | Uzantı | Yay (varsayılan / zorlama) | Dwell | Takım değişimi | Spindle | Yorum | Güven |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mach3 | `.tap` (açma penceresi varsayılanı; `.nc`/`.txt` "All files" ile) | IJ modu General Config'te; `G91.1` / `G90.1` kodda kabul | `G4 P` saniye; "ms" kutusu işaretliyse ms | `M6` varsayılan "Ignore"; elle değişimde `M0` | `M3 S`; S yalnızca PWM / step-dir kurulumda etkili, röleli kurulumda devir inverterden | `( )`, `(MSG,..)`; `;` belgelenmemiş; satır 256 | orta |
| Weihong NcStudio / NK105 | `.nc` (NK105 `.u00`, `.txt` de) | IJ artımlı parametreyle (V8 N4063); `G90.1`/`G91.1` yok; R önerilir | `G04 P` **ms** | `T` tek başına takım seçer, `M06` tabloda yok; elle değişimde `M05`+`M00` | `M03 S`/`M05`; F/S parametreyle yok sayılabilir | **`'`** satır sonuna kadar; `( )` belgelenmemiş | orta |
| RichAuto DSP A11/A18 | `.nc` (diğerleri bilinmiyor) | "AbsCntr" ayarı, varsayılan bilinmiyor; Fusion artımlı IJ yazar | `G4 P` saniye (yalnız Fusion postu) | ATC yok: menüden takım değiştirme konumu + Z yeniden sıfır | Çoğunlukla S1-S8 kademe (VFD terminal); S→kademe eşlemesi bilinmiyor | `( )` (Fusion), satır 80 | düşük-orta |
| Syntec | `.nc` veya serbest; ad en fazla 32 karakter | IJ artımlı (Fanuc gibi); `G90.1`/`G91.1` yok; R var | `G04 P` **ms** tam sayı, veya `G04 X` saniye noktalı | `T.. M06` + `G43 Z.. H..`; `M00` spindle'ı durdurur | `S.. M03` / `M05` | `( )` büyük harf ASCII (Fusion), `//` | orta-yüksek |
| LNC MW | `.nc` (Fusion) | IJ artımlı; R var; `G90.1`/`G91.1` yok | `P` **ms**, `X` saniye | `T.. M06` + `G43 H` | `M03`/`M05` | Kılavuzda `/* */`; Fusion `( )` | orta |
| Delta NC300/311 | bilinmiyor | IJ artımlı; R var | `X` saniye, `P` **ms** | `M06` MLC'de, üreticiye bağlı | `M03`/`M05` MLC'de | bilinmiyor | düşük-orta |
| GRBL 1.1 | `.nc` (gönderici programa bağlı) | Yalnız artımlı IJ; `G91.1` etkisiz, `G90.1` hata | `G4 P` saniye | `M6` **error:20**, iş durur; `M0` kullanılmalı | `M3 S` PWM (`$30`/`$31`) | `( )`, `;`; satır **80** | yüksek |
| grblHAL | `.nc` | GRBL ile aynı | `G4 P` saniye | `$341` ayarına bağlı | `M3 S` | `( )`, `;`; satır 256 | yüksek |
| FluidNC | `.nc`, SD karttan da | GRBL ile aynı | `G4 P` saniye | ATC/makro yoksa `M6` durmadan geçer; `M0` kullanılmalı | `M3 S` | `( )`, `;`; satır 255 | orta |
| DDCS V3.1/V4.1/Expert | `.nc` (`.tap` örneklerde) | IJ artımlı; `G91.1` satırı belgede çelişkili | `G4 P` **ms** | `M6 T` `T.nc` makrosunu çalıştırır; `M0` daha güvenli | `M3 S`/`M5`, 0-10 V | `( )`; ondalık ayıracı `.` | orta |
| Masso G3 | `.nc` (+`.cnc .tap .txt`) | belgelenmemiş | `G04 P` **ms** | `M05` sonra `T.. M06` | bilinmiyor | bilinmiyor | orta-düşük |
| UCCNC | bilinmiyor | bilinmiyor | ayar kutusuna bağlı | `M6.txt` makrosu | bilinmiyor | bilinmiyor | düşük |
| Eding CNC | `.cnc` | artımlı; ayarla mutlak | `G4 P` saniye | Varsayılan elle durur; ATC'de `macro.cnc` | bilinmiyor | `( )`, `;` | düşük-orta |
| Biesse / SCM / Homag / TPA | `.cix`/`.bpp`, `.xxl`, `.mpr`, `.tcn` | G-code değil | - | - | - | - | orta |

### Postlar arası ortak çıkarımlar
1. **Dwell birimi controller'a göre değişir.** Saniye: Mach3 (varsayılan), GRBL ailesi, Eding, RichAuto (zayıf kaynak). Milisaniye: Weihong, Syntec (`P`), LNC (`P`), Delta (`P`), DDCS, Masso. Fanuc tarzı controller'larda `P` noktasız tam sayı yazılmalı (`G04 P5000`); `X` ile saniye de kullanılabilir.
2. **`G91.1` yalnızca Mach3/Mach4'te (ve GRBL'de etkisiz) var.** Syntec, LNC, Weihong ve Delta'da yok. Bu controller'larda IJ zaten artımlı (Fanuc standardı) veya parametreye bağlı; Weihong için R yayı daha güvenli.
3. **Birim kodu:** Syntec belgelerine göre `G71` mm (`G21` değil). Makinede `G21` kabul ediliyor mu doğrulanmalı.
4. **Noktasız sayı:** Syntec noktasız sayıyı en küçük birim (0.001 mm) okur. Tüm koordinat ve besleme değerlerine ondalık nokta yazılmalı (postumuz zaten sabit ondalık yazıyor; `F6000` noktasız, Syntec için `F6000.` gerekebilir).
5. **Yardımcı M kodları (vakum, pim, toz emme) neredeyse her yerde makine üreticisine bağlı.** LNC MW fabrika varsayılanında `M8/M9` pozisyonlama pimidir, vakum `M10/M11`'dir. GRBL'de `M7` derleme seçeneğidir. Vakum kodu makine profilinde kalmalı, post varsayılanı olmamalı.
6. **Yorum sözdizimi tek değil.** Weihong `'` kullanır; post ayarında bu seçenek yok (`comments.style` yalnız `paren` / `semicolon`). Ya seçenek eklenmeli ya da Weihong postunda yorumlar kapatılmalı.
7. **Delik döngüleri:** GRBL ve FluidNC'de yok, DDCS'de standart dışı. `drill.cycles = none` her yerde güvenli varsayılan; Syntec/LNC için G81/G83 sonradan açılabilir.

## Türkiye pazarı (kamuya açık kanıt)
Türkiye için pazar payı rakamı yayımlanmış değil. Aşağıdaki sıralama üretici kataloglarından ve ürün sayfalarından çıkarıldı (ilan siteleri erişime kapalıydı). Ayrıntılı kanıt tablosu PR açıklamasında; ana kaynaklar aşağıda.

**Mobilya / panel (ATC, nesting):**
1. **Syntec**: Türkiye'ye satılan Çin ATC makinelerinde standart (iGolden 60WB, Blue Elephant 21MA-E, BuyCNC), Türk üreticilerde seçenek (Diacam DP, Fourmak). Syntec'in Türkiye şubesi ve ikinci el yedek parça pazarı var [M1][M2][M3][M4][M5].
2. **LNC**: Çin nesting makinelerinde standart veya seçenek (Blue Elephant, STYLECNC, iGolden) [M6][M7][M3].
3. **Avrupa makinelerinin kendi formatları** (Biesse, SCM, Homag, Felder): orta-büyük fabrikalarda; G-code postu değil [M8], ayrıntı `panel-lines-osai-tpa.md`.
4. **Siemens 828D / Delta NC**: bazı Türk "premium" makinelerde (Diacam, Fourmak seçenekleri) [M1][M9].
5. **Weihong NcStudio**: Çin router'larında küresel olarak çok yaygın, Türkiye kanıtı zayıf [M10][M11].

**Reklam / tabela / küçük atölye:**
1. **DSP el kumandası (çoğu RichAuto A11)**: Türk üreticilerde (Diacam DIA/DM, Linermak) ve Çin 1325 makinelerinde standart [M1][M12][M13].
2. **Mach3**: küçük Türk üreticilerin ve ekonomik modellerin varsayılanı (Mermak "Ops" modelleri, Fourmak seçeneği) [M14][M9].
3. **Weihong NcStudio / NK105**: orta.
4. **GRBL / FluidNC**: yalnız masaüstü ve hobi makineleri.
5. **DDCS, Falcon MDC gibi bağımsız ISO üniteler**: düşük; Fourmak seçeneklerinde Falcon MDC geçiyor, kimliği doğrulanmadı [M9].

**Listeye eklenmesi gerekenler (araştırma sonucunda):** Siemens 828D (ISO modu), Biesse/SCM/Homag formatları (ayrı iş). Adtech, KND, Weihong Lambda ve Beckhoff için Türkiye kanıtı bulunamadı.

## Önerilen post yazma sırası (Mach3'ten sonra)
1. **RichAuto DSP**: tabela ve küçük atölyede en yaygın; takım değişimi yok, basit post. Önce bir makinenin G Code Setup ekranı ve çalışan bir dosyası gerekir (belge zayıf).
2. **Syntec**: mobilya/ATC segmentinin bir numarası; Fanuc tarzı (`T M06`, `G43 H`, ms dwell, `G71`) "ISO çekirdeği" olarak yazılırsa LNC ve Delta bunun varyantı olur.
3. **Weihong NcStudio**: Çin router'larında yaygın; ms dwell, `'` yorum ve R yay için post ayarına iki küçük ekleme ister.
4. **LNC**: nesting makinelerinde standart; Syntec postunun küçük varyantı (M kodları parametreli).
5. **GRBL / FluidNC**: hobi segmenti; ucuz iş (`M6` yok, satır 80, saniye dwell). Mevcut `generic` posta çok yakın.
6. **DDCS ve Delta NC**: düşük talep; ISO çekirdeğinin varyantları.
7. **Sonra:** Siemens 828D ISO modu; Biesse/SCM/Homag formatları ancak fabrika müşterisi gelince (G-code değil, ayrı dışa aktarıcı).

## Makine olmadan çözülemeyenler
- **Mach3:** dwell ms kutusu, `G91.1` kabulü, M7'nin hangi çıkışı sürdüğü (kılavuzun tablosu ve metni M7/M8 konusunda çelişiyor), S'nin etkili olup olmadığı, Motor Tuning hızları, homing, lisans (demo 500 satır). Liste: `mach3-saha-kontrol.md`.
- **Her controller için:** gerçek dwell davranışı (kronometreyle), yay yönü testi, vakum M kodu, dosya adı sınırı ve Türkçe karakter, satır sonu (CRLF/LF), dosya boyutu sınırı. Bu bilgiler hiçbir controller için belgede bulunamadı.
- **RichAuto:** G Code Setup ekran fotoğrafı, B57/B58 ATC davranışı. **Syntec:** `G21` kabulü, Pr3241, `%`/`O` satırı zorunluluğu, ATC'siz makinede `M06`. **Weihong:** IJK parametresi, `( )` yorumun davranışı, `T2` ne yapar.
- En ucuz doğrulama: her controller için bir makineden çalışan 2-3 NC dosyası (`docs/machines/_template/` formu) ve 3-5 ustaya "makinenizde hangi kumanda var?" sorusu.

## Kaynaklar (pazar notu)
Erişim tarihi hepsi için 2026-11-23. Controller kaynakları ilgili dosyalarda.
- [M1] Diacam, CNC Router ürün sayfası. https://diacam.com.tr/cnc-router [üretici]
- [M2] Syntec Turkey, Woodworking. https://syntec-turkey.com/en/woodworking/ [controller üreticisi]
- [M3] iGolden CNC, "Choose the suitable CNC router controller". https://www.igolden-cnc.com/choose-the-suitable-cnc-router-controller/ [makine üreticisi]
- [M4] iGolden CNC, ATC nesting + testere (TR). https://www.igolden-cnc.com/tr/product/atc-nesting-cnc-route-saw-cutting/ [makine üreticisi]
- [M5] Blue Elephant, 2040 ATC otomatik yükleme (TR). https://www.cncrouter-shop.com/tr/pro/2040-atc-cnc-router-with-auto-loading-and-unloading/ [makine üreticisi]
- [M6] Blue Elephant, mobilya nesting router. https://www.cncrouter-shop.com/pro/nesting-cnc-router-machine-for-furniture/ [makine üreticisi]
- [M7] STYLECNC, otomatik nesting router. https://www.stylecnc.com/furniture-production-line/Automatic-nesting-cnc-router-machine.html [makine üreticisi]
- [M8] Felder Group, Format4 profit H08 (TR). https://www.felder-group.com/tr-en/products/cnc-machining-centres/cnc-machining-centre-profit-h08-classic.html [makine üreticisi]
- [M9] Fourmak, teklif formu (kontrol seçenekleri). https://www.fourmak.com.tr/en/getaquote [üretici]
- [M10] CATEK, "How to choose control system for CNC wood router". https://www.catekcnc.com/blogs/cnc-router/how-choose-control-system-cnc-wood-router.html [makine üreticisi blogu]
- [M11] STYLECNC, "Introduction to control system of CNC wood router". https://stylecnc.com/user-manual/Introduction-to-control-system-of-CNC-wood-router.html [makine üreticisi]
- [M12] Linermak, LM-R1000. https://linermak.com.tr/urun/20/lm-r1000-cnc-router-makinesi [üretici]
- [M13] STYLECNC, 1325 4 eksen router (RichAuto A11). https://stylecnc.com/cnc-wood-router/STYLECNC-1325-CNC-router-with-4-axis-rotary.html [makine üreticisi]
- [M14] CNC Marketi, büyük CNC router fiyatları (Mermak modelleri). https://www.cnc-marketi.com/kategori/buyuk-cnc-router-fiyatlari/ [satıcı]

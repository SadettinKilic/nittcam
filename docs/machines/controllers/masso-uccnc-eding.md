# MASSO G3, UCCNC, Eding CNC (kısa not)
> Durum: kısa araştırma notu, makinede doğrulanmadı. Tam şablon değildir, yalnız post için kritik maddeler var. Güven: düşük-orta. MASSO için resmi dokümanlar kısmen açıldı. UCCNC kılavuzunun PDF metni çıkarılamadı. Eding için yalnız 2012 tarihli eski bir USBCNC kılavuzu açılabildi.

## MASSO G3 (MASSO, Avustralya)
- Uzantı: Load File ekranı `.nc` (yerel ve önerilen biçim), `.cnc`, `.tap`, `.wiz` (sihirbaz çıktısı), `.txt`, `.eia` dosyalarını gösterir. Dosya en fazla 4 GB olabilir, USB bellekten çalışır [1].
- Dosya adı kuralları ve USB biçimi: resmi sayfada yok (bilinmiyor). Bir eğitim kaynağı FAT32 diyor (arama özeti, belge açılamadı) [5].
- Dwell: `G04 P<milisaniye>`. Örnek `G04 P2000` = 2 saniye [2].
- M6: `T__ M06` biçiminde yazılmalı. Doküman T'nin her zaman M06'dan önce yazılmasını istiyor, `M06 T5` farklı davranır. Değişimden önce spindle `M05` ile durdurulmalı. Çok kafalı makinelerde önce `G53 Z0` gibi güvenli Z'ye çıkılmalı [3].
- Ark modu: G02/G03 sayfaları açılamadı. Desteklenen kod listesinde `G90.1`/`G91.1` geçmiyor [4]. Öneri: artımsal I/J ve `G90.1`/`G91.1` yazmamak. Makinede doğrulanmalı.
- Diğer kodlar (liste özeti): G00-G03, G04, G17-G19, G20/G21, G40-G42, G90/G91, G98/G99. M03-M05, M06, M08/M09, M30, M98/M99 [4].
- Yorumlar: bilinmiyor (parantez varsayılıyor, doğrula).
- MASSO, Vectric, Fusion, ArtCAM, SheetCAM ve BobCAD için hazır post sağlar [6]. NittCam postu Vectric MASSO postunun çıktısıyla karşılaştırılarak doğrulanabilir.

## UCCNC (CNCdrive, Macaristan)
- Yazılım RS274 G/M kodlarını çalıştırır. G33/G76 dişli kesme, G33.1/G33.2 rigid tapping, G54-G59, G52/G92 desteklenir [7]. Tam kod listesi kullanıcı kılavuzunda: https://www.cncdrive.com/UCCNC/UCCNC_usersmanual.pdf [7]. PDF indirildi ama metni çıkarılamadı, bu yüzden ayrıntılar doğrulanmadı.
- Dwell: Configuration > General settings sayfasında "Measure dwell in seconds instead of msec" kutusu var. Kutu M3/M4 gecikmelerini de etkiler. Varsayılan birim forumda çelişkili anlatılıyor: bir kullanıcı kutu işaretsizken `G4 P5000`'in 5 saniye beklediğini yazıyor (forum, ikincil kaynak; arama özeti, belge açılamadı) [8]. Post birimi makine profilinden almalı.
- M6: M6 makro dosyası (`M6.txt`) profil klasöründeki Macro klasöründedir. Ayarlarda M6 makro işleme açılmazsa varsayılan "hiçbir şey yapma"dır. Takım değişimini T değil M6 başlatmalıdır (forum, ikincil kaynak; arama özeti, belge açılamadı) [9].
- Uzantı, ark modu ve yorumlar: bilinmiyor. Mach3'e benzer dil kullandığı biliniyor ama kaynakla doğrulanmadı. Mach3 postu başlangıç noktası olabilir, makinede doğrulanmalı.

## Eding CNC (Eding CNC B.V., Hollanda; eski adı USBCNC)
Not: aşağıdaki bilgiler USBCNC kılavuzu Release 4.00.11'den (Mart 2012). Güncel Eding CNC sürümleri farklı olabilir. Güncel kılavuzlar edingcnc.com/manuals sayfasında [11].
- Dwell: `G4 P<saniye>`, negatif P hatadır [10].
- Ark: I/J/K başlangıç noktasından merkeze ofsettir (artımsal). "AbsoluteCenterCoords" ayarı açılırsa I/J/K mutlak yorumlanır; kılavuz çoğunlukla artımsal kullanıldığını söylüyor [10]. Başlangıç ve bitiş yarıçapı 0.002 mm'den fazla farklıysa hata verir [10].
- M6: `M6 Tx` biçimi, T0 takımsız anlamına gelir. Varsayılan olarak program manuel değişim için durur. Takım değiştirici varsa M6, `macro.cnc` dosyasındaki `change_tool` alt programına GOSUB'a çevrilir. "AutoToolChange" ayarı işin durmasını engeller [10].
- Yorumlar: parantez içi yorumdur, ilk `)` ile biter, iç içe olamaz. `(MSG,...)` ekranda mesaj gösterir [10]. Makro örneklerinde `;` de satır yorumu olarak kullanılıyor [10].
- N: 0-99999 arası, en çok 5 hane [10].
- Döngüler: G81-G89 var, G83 Q ister [10]. Soğutma M7 mist, M8 flood, M9 kapalı [10]. G53 G0/G1 ile ve her satırda yazılır [10].
- Uzantı: kılavuz örnekleri `.cnc` kullanıyor (`demo.cnc`, `macro.cnc`). Tam liste bilinmiyor [10].

## Özet tablo
| Kontrolör | Uzantı | Ark | Dwell | M6 | Yorum |
|---|---|---|---|---|---|
| MASSO G3 | `.nc` (ayrıca `.cnc` `.tap` `.txt` `.eia`) [1] | I/J artımsal varsayım, G90.1/G91.1 listede yok [4] | `G04 P` ms [2] | `T__ M06`, önce M05 [3] | bilinmiyor |
| UCCNC | bilinmiyor | bilinmiyor | `G4 P`, birim ayara bağlı [8] | `M6.txt` makrosu, ayarda açılmalı [9] | bilinmiyor |
| Eding CNC | `.cnc` (örnek) [10] | artımsal varsayılan, ayarla mutlak [10] | `G4 P` saniye [10] | `M6 Tx`, durur veya `change_tool` [10] | `( )`, `;` [10] |

## Kaynaklar
1. MASSO Documentation, Loading & Running G-Code. https://docs.masso.com.au/getting-started-guides/machining-with-masso/loading-and-running-g-code (erişim 2026-11-23) [maker doc]
2. MASSO Documentation, G04 Dwell. https://docs.masso.com.au/supported-g-codes/g04-dwell (erişim 2026-11-23) [maker doc]
3. MASSO Documentation, M06 Tool Change. https://docs.masso.com.au/supported-m-codes/m06-tool-change (erişim 2026-11-23) [maker doc]
4. MASSO Documentation, Other CAM post processors (desteklenen kod listesi özeti). https://docs.masso.com.au/cam-post-processors/other-cam-postprocessors (erişim 2026-11-23) [maker doc]
5. CanCAM, Masso training V2 (arama özeti, belge açılamadı). https://cancam.freshdesk.com/support/solutions/articles/62000221658-masso-training-v2 (erişim 2026-11-23) [reseller, ikincil kaynak]
6. MASSO Documentation, CAM Post Processors. https://docs.masso.com.au/cam-post-processors (erişim 2026-11-23) [maker doc]
7. CNCdrive, UCCNC ürün sayfası. https://www.cncdrive.com/UCCNC.html (erişim 2026-11-23) [maker page]
8. CNCdrive forum, "Dwell in seconds checkbox" (arama özeti, belge açılamadı; sayfa 403 verdi). https://forum.cncdrive.com/viewtopic.php?p=23589 (erişim 2026-11-23) [forum, ikincil kaynak]
9. Stepcraft forum, "help with m6 macro" ve CNCdrive forum, "M6 tool change macro" (arama özeti, belge açılamadı). https://www.stepcraft-systems.com/forum/accessories/3288-help-with-m6-macro , https://forum.cncdrive.com/viewtopic.php?p=32771 (erişim 2026-11-23) [forum, ikincil kaynak]
10. USBCNC User Manual Release 4.00.11 (Eding CNC, 2012), bölüm 2.1.11, 2.1.15, 2.4.2-2.4.3, 3.3.1, 3.3.4, 3.5.3, 3.5.4, 3.5.20. Ayna: https://manualzilla.com/doc/5728184/usbcnc-manual (erişim 2026-11-23) [maker manual, eski sürüm, ayna kopya]
11. Sorotec, Quickstart Eding (manuels sayfasına yönlendirme; arama özeti, belge açılamadı). https://www.upload.sorotec.de/doku/manuals/Qickstart_Eding.pdf (erişim 2026-11-23) [builder doc]

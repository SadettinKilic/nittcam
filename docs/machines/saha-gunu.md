# Saha günü: Mach3 router, elle takım değişimi, MDF 18 mm

> Sahibi için tek sayfalık akış ve götürülecekler listesi. Kaynak: CTO incelemesi #13
> (`docs/reviews/2026-11-23-cto-design-review-13.md`), prova raporu
> (`docs/reviews/2026-11-23-field-rehearsal.md`), `controllers/mach3-saha-kontrol.md`, spec §12.3.
> Uygulamadaki basılı liste (Makineler → makine → Doğrula → Saha testi kiti) bununla birlikte kullanılır;
> çelişirse bu sayfa geçerlidir.

## Üç kural

1. **Sıra değişmez:** Mach3 ön kontrol → air cut → 200 × 200 test parçası → (isterseniz) genişletilmiş parça → dolap işi. Bir adım geçmeden sonrakine başlanmaz.
2. **El acil stopta, besleme düşük:** her dosyanın ilk çalıştırmasında Feed Override %25–50, bir el acil stop düğmesinde. Program sorunsuz ilerledikçe %100'e çıkın.
3. **Şüphe varsa durun.** Durmak hiçbir şeyi bozmaz; devam etmek takım, plaka ya da tabla kırabilir. Aşağıdaki "Dur, devam etme" listesi bağlayıcıdır.

## Gitmeden (evde, uygulamada)

1. **Kendi makinenizi ekleyin.** "Örnek router (Mach3)" yalnızca örnektir ve hiçbir zaman "doğrulanmış" olmaz. Makineler → Yeni makine → kontrolcü kütüphanesinden Mach3. Bildiğiniz kadarını girin (tabla, hareket sınırları, sıfır köşesi, takımlar); eksikleri makinenin başında tamamlayın.
2. **Park noktasını kapalı bırakın** (Takım değiştirici → "Takım değişiminde park noktasına git" işaretsiz). Makinede home anahtarı olduğunu ve "Ref All Home" yapıldığını görmeden açmayın.
3. **Vakum kodu:** vakumu programdan açıp kapatmıyorsanız (çoğu atölyede vana ya da şalterle açılır) "Vakum aç / kapat kodu" alanlarını **boş** bırakın. M7, Mach3'te çoğu makinede soğutma çıkışıdır.
4. Doğrulama sayfasından `AIRCUT_S1.tap`, saha kitinden `AIRCUT_GENIS_S1.tap` dosyalarını indirin. Test parçası dosyaları air cut onayından sonra açılır; onları makinenin başında indireceksiniz (telefon ya da dizüstü gerekir).
5. Dolap işini hazırlayın: Parçalar → Dolap ekle (MDF 18) → Kapak → Çizim → Şablon ekle: "Menteşe çukuru Ø35 (2 menteşe)" ve "Kulp deliği 128 mm".
6. **Dizilim adımında köprü açık kalsın; payları elle değiştirmeyin.** Uygulama köprü açıkken parça arası payı en az takım Ø + 3,1 mm (Ø8: parçalar arası 19,1 mm), kenar payını en az Ø + 3 mm kullanır ve bunu Dizilim'de bir notla söyler (D-129). Böylece her köprünün arkasında 3 mm malzeme kalır ve köprü parçayı tutar. Dosya başlığında `KOPRU AZ` satırı varsa bazı parçalar istenenden az tutan köprüyle kesilir: Simülasyon'daki uyarıya bakın, dışa aktarmadaki köprü satırını işaretlemeden indirme açılmaz. Küçük parça yeterli köprü alamıyorsa uygulama dosyayı hiç vermez.
7. Simülasyon → Kesim ayarları: Köprü "Her parçada" kalsın. İlerleme ve dalma değerlerine dokunmayın ("önerilen").
8. Saha kitini ve dolap işinin A4 PDF'ini yazdırın. USB'ye yalnızca bugünün dosyalarını koyun.

## Yanınızda götürün (ve makineden öğrenin)

| # | Ne | Neden |
| --- | --- | --- |
| 1 | Makinede bugün sorunsuz çalışan 2–3 NC dosyası (USB'den olduğu gibi) | Post ayarını tahminle değil bunlara bakarak düzeltiriz; en değerli madde |
| 2 | Mach3 ekranının ve Help > About'un fotoğrafı (sürüm, "Demo" yazıyor mu) | Demo sürüm 500 satırda durur; dolap işi 400–540 satırdır |
| 3 | Config > General Config ekranının fotoğrafı | "G04 Dwell in ms", IJ modu, hareket modu (CV), "Program end / M30" seçenekleri, Initialization String tek karede |
| 4 | Config > Spindle Setup ve Ports & Pins > Output Signals fotoğrafı | M7 hangi çıkışı açıyor; devir S ile mi, inverterden elle mi; spindle'ı M3 mü açıyor |
| 5 | Config > Motor Tuning: X, Y, Z "Velocity" ve "Accel" | İlerleme tavanı: dosya F6000 / dalma F1500 yazar; makine daha yavaşsa profile yazılır |
| 6 | Config > Homing/Limits fotoğrafı; home anahtarı var mı | Park (G53) ve soft limit yalnızca home edilmiş makinede güvenlidir |
| 7 | Tabla ölçüsü, X / Y / Z hareket sınırı, köprünün altındaki boşluk (mm) | Profildeki çalışma alanı; güvenli Z 20 mm makineye sığıyor mu |
| 8 | Program sıfırı hangi köşe, X+ ve Y+ yönü, plaka nereye dayanıyor (pim, cetvel) | Profildeki orijin; dayama pimi kesim yolunda mı |
| 9 | Tutma şekli: vakum (pompa nasıl açılıyor), mengene, vida; fire tabla kalınlığı ve durumu | Köprü ve küçük parça kararı buna bağlı; 0,5 mm fire tabla payı |
| 10 | Z sıfırlama yöntemi: kâğıt, prob plakası (kalınlığı), takım boyu ölçer | Her takım değişiminden sonra yapılacak iş; en sık hata kaynağı |
| 11 | Takımlar: Ø8 (T2) ve Ø6 (T1), birer yedek; her birinin gerçek çapı, kesici boyu, ağız sayısı, tipi | İkisi de **dalabilen (ucu kesen) spiral** freze olmalı: T1 deliği ve cebi dik dalarak açar. Kesici boyu ≥ 22 mm (18,5 mm kesim) |
| 12 | Pens ve anahtarlar; spindle en düşük / en yüksek devir | Elle değişim; devir aralığı profile yazılır |
| 13 | Fire MDF 18 mm: en az 300 × 300, 400 × 300 ve dolap işi için bir tam plaka (2800 × 2070 ya da kendi ölçünüz) | Test parçaları ve ilk iş |
| 14 | Plakanın gerçek kalınlığı (kumpasla 4 köşe) | 18'den sapma köprü kalınlığını ve tabla izini değiştirir |
| 15 | Kumpas (0,02 mm, derinlik uçlu), metre, gönye | Ölçü formu; köşegen ölçüsü |
| 16 | Menteşe ve kulp (kendi kullandığınız) | Şablon ölçüleri doğrulanmamış: Ø35 × 12 çukur kenardan 22,5 mm, kulp 128 mm |
| 17 | USB bellek, telefon (video + fotoğraf), kalem, basılı saha kiti ve PDF | Kayıt; dosya aktarımı (`.tap`, ad ≤ 32 karakter) |
| 18 | Gözlük, kulaklık, toz emme; küçük alçak kelepçe ya da vida | Güvenlik; fire plakanın sabitlenmesi |
| 19 | Dizüstü ya da telefon (NittCam açık) | Air cut onayı, test dosyası indirme, ölçü girişi, profil düzeltme |
| 20 | Makinede şu an kullanılan CAM ve post adı; MDF'de alışılmış devir / ilerleme | Karşılaştırma ve başlangıç değerleri |

Fotoğrafları ve örnek dosyaları dönüşte `docs/machines/<makine-adı>/` altına (`foto/`, `ornek-nc/`) koyun; şablon `docs/machines/_template/`.

## Makinenin başında: sıra

### A. Mach3 ön kontrol (spindle kapalı, dosya yüklemeden)

1. Yukarıdaki 2–6 numaralı fotoğrafları çekin. **Ayar değiştirmeyin**, yalnızca yazın.
2. "G04 Dwell in milliseconds" **işaretliyse durun** (aşağıdaki liste, madde 1).
3. MDI satırına `M7` yazın: ne açıldı? Vakum değilse profilde vakum kodlarını boşaltın, dosyaları yeniden indirin. `M9` ile kapatın.
4. MDI'da `M3 S18000`: spindle döndü mü, devir doğru mu? Dönmüyorsa spindle elle açılıyordur: her "Cycle Start"tan önce siz açacaksınız; bunu not edin. `M5`.
5. Makine profilini gerçek değerlerle düzeltin (tabla, sınırlar, sıfır köşesi, takım ölçüleri, Motor Tuning'e göre en yüksek ilerleme). Dosyaları **yeniden indirin**: eski sürümle üretilen dosya eski değerleri taşır.

### B. Air cut (malzemesiz)

1. T2 Ø8 takılı. X/Y sıfırı program köşesinde. Z sıfırı **fire tablanın üstünde** (dosya takımı bu yüzeyin en az 20 mm üstünde tutar).
2. `AIRCUT_S1.tap` → ilk satır `(DOGRULANMADI, once air cut)`. Feed %25. Cycle Start.
3. **İlk M0** (`TAKIM T2 D8.000 TAKILI MI?`): spindle duruyor olmalı. Takımı kontrol edin, Cycle Start.
4. İzleyin: Z önce yukarı çıktı mı · spindle döndü ve **yaklaşık 5 saniye** bekledi mi (kronometre) · X sağa, Y arkaya gidiyor mu · daireler küçük ve yerinde mi · sonda Z yukarı, spindle durdu, program başa sardı mı.
5. Sorunsuzsa aynısını `AIRCUT_GENIS_S1.tap` ile yapın. Sonra uygulamada dört kutuyu işaretleyip "Air cut'ı onayla".

### C. Test parçası 200 × 200 (fire plakada)

1. 300 × 300 fire plakayı sabitleyin. **Kelepçe ve vidalar yalnızca plakanın dış 30 mm'lik bandında** ve plaka üstünden **20 mm'den alçak** olsun: takım 42–258 mm arasında keser, parçalar arası 20 mm yükseklikte hızlı geçer.
2. **Z sıfırını plakanın üst yüzeyinde yeniden alın.** Air cut'ta tablaya alınan sıfırla kesmeyin.
3. `TESTPARCA_S1.tap`, feed %50. İlk dalışı izleyin: takım malzemeye yavaş (dalma hızıyla) girmeli.
4. Bitince: 4 köprü parçayı tutuyor mu, tabla izi 0,5 mm civarında mı. Köprüleri kesin, ölçün, uygulamadaki forma girin (kenar X, kenar Y, köşegen, delik çapı, cep derinliği).
5. Ölçüler toleranstaysa devam. Değilse uygulamanın önerdiği düzeltmeyi yazın, durun (madde 7).

### D. Genişletilmiş test parçası (isteğe bağlı)

`TESTPARCA_GENIS_S1.tap` 300 × 200 dış konturu 4 köprüyle keser (düz kenarlarda; R20 yaylarda köprü yok). Dosya başlığında `kopru her parcada 4 adet` yazmalı. İç pencere (80 × 50) 3 köprüyle kesilir; Uyarılar'daki `TABS_REDUCED` bundandır, normaldir. Zaman yoksa atlayın; delik, cep, yay ve menteşe çukurunu dolap işi zaten dener.

### E. İlk gerçek iş: dolap (iki takım)

1. Plakayı yerleştirin, vakumu açın. Dosya başlığını okuyun: `PLAKA 1/1`, `TAKIMLAR: T1 D6.000, T2 D8.000`, `KESIM: kopru her parcada 4 adet`. PDF'teki plaka ve sıfır köşesi işaretiyle karşılaştırın.
2. **Önce havada bir geçiş:** T1 takılıyken Z sıfırını plakanın **40 mm üstünde** alın (plakanın üstüne 40 mm'lik bir takoz koyup onun üstüne sıfırlayın). Dosyayı %100 ilerlemeyle çalıştırın: en derin hareket plakanın 21,5 mm üstünde kalır. Amaç program ortasındaki takım değişimini malzemesiz görmek.
3. **Program ortasındaki M0** (`TAKIM DEGISTIR: T2 D8.000 - Z SIFIRLA - SONRA CYCLE START`): spindle **tamamen durmuş** olmalı (durmadıysa bkz. madde 4, dur). Takımı değiştirin, Z'yi yeniden sıfırlayın (bu provada yine 40 mm takozun üstünde), elinizi çekin, Cycle Start. Makine önce Z'yi yukarı almalı, spindle'ı açmalı, 5 sn beklemeli, sonra gitmeli.
4. Havadaki geçiş temizse gerçek kesim: T1'i takın, **Z sıfırını plakanın üstünde** alın, feed %50 ile başlatın. Menteşe çukurları ve kulp delikleri T1 ile açılır; sonra M0.
5. M0'da T2'yi takın, **Z'yi plakanın üstünde yeniden sıfırlayın** (yeni takımın boyu farklıdır; bu adım atlanırsa takım plakaya ya da tablaya gömülür). Cycle Start.
6. Kesim bitince vakumu kapatmadan önce parçalara bakın: hepsi köprülerle duruyor mu. Sonra köprüleri kesip alın.

## Her M0'da bakılacaklar

- Spindle durdu mu (göz ve kulak)? Durmadan takıma dokunmayın.
- Ekrandaki / dosyadaki mesaj hangi takımı istiyor (T numarası ve çap)? Elinizdeki o mu?
- Takım değiştiyse Z **yeniden sıfırlandı** mı? Sıfırı aldıktan sonra Z'yi elle plakadan yukarı kaldırın.
- Tablada anahtar, pens, kumpas kaldı mı? Vakum hâlâ açık mı?
- Cycle Start'tan sonraki ilk hareket Z yukarı olmalı. Başka bir şey yapıyorsa acil stop.

## Dur, devam etme

1. "G04 Dwell in milliseconds" işaretli, ya da air cut'ta spindle açıldıktan sonra bekleme olmadan hareket başlıyor.
2. Mach3 "Demo" yazıyor (dosya 500. satırda yarıda kalır).
3. Air cut'ta eksen ters yöne gidiyor, daire dev çıkıyor, "Radius to end of arc differs" ya da başka bir hata mesajı geliyor. Satır numarasını yazın.
4. M0'da spindle dönmeye devam ediyor, ya da Cycle Start'tan sonra spindle açılmadan hareket başlıyor.
5. İlk hareket Z yukarı değil; ya da takım malzemeye hızlı hareketle (G0 hızıyla) iniyor.
6. Takım plakanın kenarından dışarı çıkıyor, kelepçeye / pime yaklaşıyor, soft limit uyarısı geliyor.
7. Test parçasında ölçü farkı 0,5 mm'den büyük, cep derinliği 1 mm'den fazla sapıyor, ya da takım tablaya 1 mm'den derin giriyor.
8. Parça yerinden oynuyor, köprü kopuyor, yanık kokusu ya da sert titreşim var.
9. Dosyanın başlığındaki profil sürümü, plaka ölçüsü ya da takım listesi beklediğiniz gibi değil.

Durduktan sonra: dosyayı değiştirmeyin, makinede elle düzeltip devam etmeyin. Aşağıdakileri kaydedip gönderin; düzeltme uygulamada yapılır ve dosya yeniden üretilir.

## Kaydedin ve geri gönderin

- **Hata veren ya da şüpheli NC dosyasının kendisi** (USB'deki hali) ve durduğu satır numarası; Mach3 ekranının fotoğrafı (mesaj, DRO değerleri).
- "Yanınızda götürün" tablosundaki 1–12 numaralı bilgiler ve fotoğraflar; çalışan örnek NC dosyaları.
- Air cut ve ilk kesimin videosu (takım değişimi anı dahil).
- 200 × 200 parçanın beş ölçüsü (uygulamadaki form), genişletilmiş parça kesildiyse basılı ölçü formu; parçaların fotoğrafı.
- Dolap işi: yan (559 × 720) ve kapak (592 × 712) kumpas / metre ölçüsü, köşegen; menteşe çukuru çapı, derinliği, kenara uzaklığı; kulp delik aralığı; menteşe ve kulp yerine oturdu mu.
- Köprüler: kaç tanesi tuttu, kırması kolay mı; plaka altındaki tabla izi derinliği.
- Gerçek süre (her dosya için) ve ekrandaki tahmin; kullanılan devir ve feed override.
- Ses, titreşim, yanık, kenar kalitesi (üst ve alt yüz); Z sıfırlama yöntemi ve kaç dakika sürdüğü.
- Uygulamada takıldığınız, anlamadığınız ya da yanlış bulduğunuz her yazı (ekran görüntüsüyle).

# 3D CNC planı (M-3D)

> PO, 2026-11-28, sahibin isteği ("3d cnc için de sağlam bir backlog oluştur"). Karar: D-132. Görevler: `docs/BACKLOG.md` → "M-3D".

## 1. Kısa özet
Bugün NittCam 2,5D çalışır: plaka kesimi, cep, delik, kanal; her işlem sabit derinlikte. "3D CNC" bizim hedef kitlemizde (mobilya, tabela, kapı, dekor atölyesi; 3 eksen router) şu işleri kapsar:

| İş | Örnek | Takım | Kademe |
| --- | --- | --- | --- |
| V-oyma (V-carve) | tabela yazısı, logo, kapak motifi | V uç 60°/90° | **3D-A** (ilk; 2,5D'nin uzantısı, değişken Z) |
| Rölyef (kabartma) | kapı paneli motifi, tablo, isimlik | küresel uç (ball nose) Ø3–6, konik küresel | **3D-B** |
| 3D yüzey (STL) | oyuncak, kalıp, ergonomik kulp, heykelcik | kaba: düz uç; ince: küresel | **3D-B** |
| Çift taraflı işleme | iki yüzü işlenmiş ayak, figür | pimli hizalama | **3D-C** |
| 4. eksen (döner) | tornalanmış ayak, korkuluk | – | **3D-D** (sonra; makine envanteri gelince) |

## 2. Neden bu sıra
- V-oyma bugünkü çizim tahtasındaki konturlardan doğar (yazı, şekil); yeni girdi formatı istemez, tabelacıya hemen değer verir. Tekniği (medial eksen / ofset tabanlı derinlik) çekirdeğe saf geometri olarak girer.
- Rölyef ve STL için ortak altyapı **yükseklik alanı** (heightfield): model ızgaraya örneklenir; kaba ve ince takım yolları "drop-cutter" ile bu ızgaradan hesaplanır. 3 eksen routerda alttan kesim olmadığı için ızgara tam doğrudur ve hızlıdır. Rölyef görseli (gri ton) zaten bir yükseklik alanıdır.
- Simülasyon da aynı ızgarayla yapılır (malzeme kaldırma, Z-buffer): 3D işlerde "ne çıkacak" gösterilmeden G-code verilmez.

## 3. İlkeler (değişmez kurallarla uyumlu)
- Takım yolu `packages/core` içinde saf: ağ, zaman, rastgelelik yok; aynı girdi aynı çıktı (altın dosyalar). Ağır hesap tarayıcıda Web Worker'da çalışır, çekirdek kodu aynıdır.
- AI geometri ya da takım yolu üretmez (AI ileride yalnızca "bu görseli rölyefe çevir" önerisi yapabilir; dönüşümü yine deterministik kod yapar).
- Lisans: GPL/AGPL yok. OpenCAMLib LGPL-2.1 olduğu için **kullanılmaz**; drop-cutter ve waterline kendi kodumuz. STL okuyucu three.js (MIT). Gerekirse `three-mesh-bvh` (MIT).
- Mevcut malzemelerin altın G-code dosyaları her görevde bayt bayt aynı kalır.
- Her 3D işlem denetçiden (checker) geçer: kesme derinliği ≤ malzeme kalınlığı − taban payı, takım boyu (kesme boyu ve tutucu) yetersizse hata, oyma (gouge) kontrolü, güvenli Z, iş mili devri.

## 4. Kavramlar ve ekranlar
- **3D işlem** bir parçaya bağlıdır (çizim tahtasında "3D" sekmesi): kaynak = V-oyma konturları | gri ton görsel | STL; yerleşim (parça yüzeyinde konum, ölçek, döndürme, maks. derinlik, taban kalınlığı).
- **Strateji**: Kaba (Z-seviye, düz uç, kademeli; pay bırakır) → İnce (paralel tarama 0°/45°/90°, küresel uç, adım = kabuk yüksekliğinden) → opsiyonel Kalem/köşe temizleme (sonra).
- **Kabuk yüksekliği (scallop)**: kullanıcı "yüzey kalitesi" seçer (Kaba 0,2 / Orta 0,1 / İnce 0,05 mm); adım aralığı `2·√(2·R·h − h²)` ile hesaplanır; tahmini süre gösterilir (3D işler saatler sürebilir; süre en önemli karar verisi).
- **Takım kütüphanesi**: küresel, konik küresel, V uç (açı, uç çapı), kesme boyu, tutucu çapı.
- **Önizleme**: 3D sahnede ızgara simülasyonu, kaba/ince ayrı renk, "kalan malzeme" haritası.
- **Dizilim**: 3D işli parça normal parça gibi dizilir; 3D işlem dizilim sonrası parçanın yerine taşınır. Konturdan önce 3D işler (parça plakaya bağlıyken).

## 5. Riskler
- Hesap süresi ve bellek: 1000×600 mm parçada 0,2 mm ızgara = 15 M nokta. Çözüm: döşemeli (tiled) ızgara, Worker havuzu, çözünürlük takım çapına göre (≥ R/4), ilerleme çubuğu ve iptal.
- G-code boyutu: ince geçiş on binlerce satır; post akışla (stream) yazılmalı, Mach3 satır sınırı yok ama dosya 50 MB'yi geçmemeli; ark uydurma (G2/G3) ile küçültme 3D-B sonu.
- Güvenlik: küresel uçla tam derinlikte dalma, kısa kesme boyu, tutucu çarpması. Denetçi kuralları R20–R24 (bkz. backlog).
- Makine: hobi routerlarda düşük ivme; ince geçişte besleme düşer. Süre tahmini makine ivmesini (profil) kullanır.

## 6. Kapsam dışı (şimdilik)
5 eksen, 4. eksen sarmal işleme (3D-D'ye kadar), nokta bulutu/tarama girdisi, organik model düzenleme (biz model editörü değiliz; STL hazır gelir), lazer.

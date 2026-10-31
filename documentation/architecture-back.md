# BaselHack 2026 — Bike Parking Occupancy System

## Mission

Implémenter un système d'estimation de l'occupation de parkings à vélos, basé sur plusieurs caméras ESP32-CAM, YOLO26n et une cartographie configurable.

**Un frontend existe déjà**, notamment pour la configuration des parkings, des zones et de leur représentation graphique.

Commence par inspecter intégralement le projet existant afin de comprendre son architecture, ses composants, ses API et ses modèles de données.

**Ne reconstruis pas le frontend. Réutilise les composants existants et implémente les fonctionnalités manquantes.**

Le système doit être modulaire, fonctionner avec différents types de parkings et permettre de remplacer ultérieurement le modèle de vision sans modifier les autres composants.

---

# 1. Architecture générale

```text
ESP32-CAM (1..N)
       │
       │ Captures JPEG
       ▼
BACKEND
       │
       ├── Mode calibration
       │     ├── Capture caméra
       │     ├── Deface (CenterFace)
       │     ├── Image anonymisée
       │     └── Interface administrateur
       │
       └── Mode exploitation
             ├── Capture caméra
             ├── YOLO26n
             ├── Bounding boxes
             ├── Attribution aux polygones
             ├── Comptage par zone
             └── Occupation par caméra
                       │
                       ▼
              Fusion multi-caméras
                       │
                       ▼
                  API Backend
                       │
                       ▼
                Frontend existant
                       │
                       ▼
                  Heatmap 2D
```

Le traitement des images est effectué côté backend.

Les ESP32-CAM servent uniquement à capturer et transmettre des images.

Elles ne connaissent ni les zones, ni les autres caméras, ni les taux d'occupation.

Les images ne doivent jamais être sauvegardées.

---

# 2. Configuration administrateur

## 2.1. Parkings et zones

Chaque parking possède :

- Un identifiant unique.
- Un nom.
- Une ou plusieurs caméras.
- Une ou plusieurs zones physiques de stationnement.
- Une représentation schématique en vue du dessus.

Chaque zone possède un `zone_id` unique au sein de son parking, ainsi qu'une **capacité maximale unique et partagée entre toutes les caméras**.

Les zones appartiennent directement au parking, indépendamment des caméras.

Chaque caméra possède uniquement sa propre représentation géométrique des zones qu'elle observe.

Par conséquent :

- La capacité d'une zone est définie une seule fois au niveau du parking.
- Plusieurs caméras peuvent observer et référencer cette même zone.
- Chaque caméra possède son propre polygone pour représenter la zone dans son image.
- Modifier la capacité depuis n'importe quelle caméra met à jour la capacité de la zone physique, donc celle utilisée par toutes les autres caméras.
- Une caméra peut ne surveiller qu'une partie des zones du parking.

La géométrie des zones sur la carte aérienne est indépendante de leur géométrie dans les images des caméras.

La correspondance est assurée par :

`parking_id + zone_id`

Le frontend dispose déjà de fonctionnalités de configuration. Les réutiliser.

## 2.2. Configuration d'une caméra

Workflow :

1. L'administrateur sélectionne une caméra.
2. Le backend se connecte à celle-ci.
3. Il déclenche une capture JPEG.
4. L'image est anonymisée avec Deface.
5. L'image anonymisée est transmise temporairement au frontend.
6. L'administrateur dessine les zones surveillées sur cette image.
7. Pour chaque polygone, il peut créer une nouvelle zone physique ou sélectionner une zone existante du parking.
8. Il peut définir ou modifier la capacité maximale de la zone physique associée.
9. La configuration est enregistrée.

**La capacité appartient toujours à la zone physique, jamais à l'association caméra-zone.**

Par exemple, si une zone `zone_1` est créée depuis `camera_1` avec une capacité de 5 vélos, puis sélectionnée depuis `camera_2`, elle possède toujours une capacité de 5.

Si l'administrateur modifie cette capacité à 8 depuis `camera_2`, la nouvelle valeur devient immédiatement celle de `zone_1` pour l'ensemble du parking, y compris `camera_1`.

Les zones doivent idéalement correspondre aux surfaces au sol où les vélos sont stationnés.

Une caméra ne doit être associée à une zone que si elle possède une vue suffisamment complète et exploitable de celle-ci.

Plusieurs caméras peuvent être associées à une même zone physique.

**Les coordonnées des polygones doivent être normalisées entre 0 et 1**, afin de rester valides indépendamment de la résolution d'affichage.

Les zones doivent être configurées sans chevauchements ambigus.

### Modèle de données

Séparer explicitement les zones physiques et leurs représentations dans les caméras.

Exemple :

```json
{
  "parking_id": "parking_1",
  "zones": [
    {
      "zone_id": "zone_1",
      "capacity": 20
    }
  ],
  "cameras": [
    {
      "camera_id": "camera_1",
      "zones": [
        {
          "zone_id": "zone_1",
          "polygon": [
            [0.10, 0.30],
            [0.70, 0.30],
            [0.75, 0.85],
            [0.08, 0.85]
          ]
        }
      ]
    },
    {
      "camera_id": "camera_2",
      "zones": [
        {
          "zone_id": "zone_1",
          "polygon": [
            [0.20, 0.15],
            [0.85, 0.25],
            [0.80, 0.75],
            [0.15, 0.65]
          ]
        }
      ]
    }
  ]
}
```

La capacité ne doit pas être dupliquée dans les configurations propres aux caméras.

Utiliser une relation entre les caméras et les zones physiques pour stocker les polygones.

Seules les données géométriques et numériques sont persistantes.

Lors d'une modification ultérieure, une nouvelle photographie est capturée.

---

# 3. Confidentialité : Deface

Utiliser **Deface (ORB-HD/deface)** pour anonymiser automatiquement les visages.

Référence :  
https://github.com/ORB-HD/deface

Deface utilise CenterFace pour la détection des visages et dispose de ses propres mécanismes d'anonymisation.

Il fonctionne indépendamment de YOLO26n.

## Intégration

Le traitement doit impérativement être réalisé en mémoire.

Pipeline :

```text
JPEG caméra
    ↓
Décodage en RAM
    ↓
Détection CenterFace / Deface
    ↓
Masquage des visages
    ↓
Encodage en mémoire
    ↓
Envoi au frontend administrateur
```

Examiner l'implémentation de Deface et réutiliser son détecteur ainsi que ses mécanismes d'anonymisation.

**Ne pas utiliser directement une commande CLI qui écrit des fichiers sur disque.**

Privilégier une intégration Python manipulant des tableaux NumPy/OpenCV.

Utiliser un masquage opaque des visages détectés, avec une marge autour des régions détectées.

## Contraintes

- Aucune image brute persistée.
- Aucune image anonymisée persistée.
- Aucun fichier temporaire contenant une photographie.
- Aucun enregistrement des captures dans les logs.
- Aucun cache disque des captures.
- Aucun stockage des images en base de données.
- Réponses HTTP contenant des images avec `Cache-Control: no-store`.
- Transmission des images de calibration uniquement aux administrateurs authentifiés.
- Aucune image brute transmise au navigateur.
- Libération des références aux images après traitement ou fermeture de la session.

Si l'anonymisation échoue, ne pas transmettre l'image.

Le détecteur peut manquer certains visages : ne pas présenter son résultat comme une garantie absolue d'anonymisation.

En fonctionnement normal, le système n'a pas besoin de transmettre d'images aux utilisateurs.

---

# 4. Détection des vélos : YOLO26n

Utiliser par défaut :

`yolo26n.pt`

Avec Ultralytics.

Prévoir une configuration permettant de sélectionner le modèle utilisé.

Le moteur doit accepter différents modèles compatibles, sans coupler la logique géométrique à YOLO.

## Pipeline d'inférence

Pour chaque image :

1. Charger l'image en mémoire.
2. Exécuter YOLO26n.
3. Filtrer les détections sur la classe `bicycle`.
4. Récupérer les bounding boxes et confidences.
5. Appliquer l'algorithme d'attribution aux zones.
6. Compter les vélos par zone.
7. Calculer les occupations.
8. Libérer l'image après traitement.

Exemple de données internes :

```python
{
    "bbox": [x_min, y_min, x_max, y_max],
    "confidence": 0.91,
    "class": "bicycle"
}
```

Les seuils de confiance et la résolution d'inférence doivent être configurables côté backend.

Ne pas enregistrer automatiquement les images annotées générées par Ultralytics.

---

# 5. Algorithme d'attribution aux zones

C'est le cœur du système de comptage.

Chaque vélo est représenté par sa bounding box :

`(x_min, y_min, x_max, y_max)`

On détermine un point horizontal situé au centre :

\[
x = \frac{x_{min}+x_{max}}{2}
\]

Puis on cherche un point vertical appartenant à un polygone de stationnement.

La recherche commence à **95 % de la hauteur de la bounding box**, puis remonte progressivement jusqu'à 65 %.

```python
for ratio in (0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65):
    y = y_min + ratio * (y_max - y_min)

    # Tester (x, y) dans les polygones.
    # Dès qu'une zone est trouvée, attribuer
    # le vélo et arrêter la recherche.
```

Utiliser un algorithme standard de `point-in-polygon`, par exemple `cv2.pointPolygonTest`.

Règles :

- Les coordonnées des détections et des polygones doivent être converties dans le même repère.
- Le X reste au centre de la bounding box.
- Les ratios sont testés dans l'ordre décroissant.
- Dès qu'un point appartient à une zone, le vélo est attribué à celle-ci.
- Un vélo ne peut être attribué qu'à une seule zone.
- Si aucun point n'appartient à une zone, le vélo est ignoré pour le comptage.
- Les points situés exactement sur la frontière doivent être traités de manière cohérente.
- En cas de polygones superposés, la configuration doit être considérée comme ambiguë et signalée.

Isoler cet algorithme dans une fonction indépendante du moteur d'inférence.

Il doit être possible de le tester avec des bounding boxes artificielles, sans charger YOLO.

---

# 6. Calcul de l'occupation

Chaque zone physique possède **une capacité maximale unique**, définie au niveau du parking et partagée entre toutes les caméras qui l'observent.

Chaque caméra produit son propre comptage, mais utilise obligatoirement cette capacité commune pour calculer son taux d'occupation.

Pour une caméra donnée :

\[
Occupancy_{camera,zone} =
\frac{DetectedBicycles_{camera,zone}}{Capacity_{zone}}
\]

Exemple :

```text
Parking 1 / Zone 1
Capacité partagée : 20

camera_1
Detected: 15
Occupancy: 0.75

camera_2
Detected: 17
Occupancy: 0.85
```

Les deux caméras utilisent la même capacité de 20.

Si l'administrateur modifie la capacité de `zone_1`, cette modification s'applique immédiatement aux calculs d'occupation de toutes les caméras associées.

Le backend doit utiliser la capacité actuelle de la zone comme source de vérité, et non une ancienne valeur enregistrée dans les paramètres d'une caméra.

Les occupations peuvent être recalculées à partir des derniers comptages valides sans relancer systématiquement YOLO.

Règles :

- La capacité doit être strictement positive.
- Le nombre brut de détections est conservé.
- L'occupation destinée à l'affichage est bornée entre 0 et 1.
- Si le nombre détecté dépasse la capacité, conserver cette information pour le diagnostic.
- Une caméra déconnectée ne doit pas produire artificiellement une occupation de 0.
- Une analyse échouée doit produire une mesure invalide, et non une zone vide.
- Une modification de capacité doit être reflétée dans toutes les occupations utilisant cette zone.

Une occupation de 0 signifie qu'une image a effectivement été analysée et qu'aucun vélo n'a été attribué à cette zone.

---

# 7. Fusion multi-caméras

Plusieurs caméras peuvent surveiller une même zone physique.

Chaque caméra calcule indépendamment son nombre de vélos détectés, puis son taux d'occupation à partir de la **capacité commune de la zone**.

Le backend fusionne les occupations selon :

`parking_id + zone_id`

## Méthode V1 : moyenne arithmétique

\[
Occupancy_{zone} =
\frac{1}{N}\sum_{i=1}^{N} Occupancy_i
\]

Exemple :

```text
Parking 1 / Zone 1
Capacité commune : 20 vélos

Camera A → 14 vélos → 70 %
Camera B → 16 vélos → 80 %
Camera C → 18 vélos → 90 %

Occupation finale → 80 %
```

Puisque les caméras utilisent toutes la même capacité, la moyenne représente l'estimation commune de l'occupation de cette zone.

Seules les caméras explicitement configurées pour observer correctement et de manière suffisamment représentative la zone participent à la fusion.

Ne pas fusionner automatiquement toutes les caméras simplement parce qu'elles existent.

## Validité des mesures

Chaque mesure doit posséder :

- Un `camera_id`.
- Un `parking_id`.
- Un `zone_id`.
- Un timestamp.
- Un nombre de vélos détectés.
- Une occupation calculée à partir de la capacité commune.
- Un statut de validité.

La capacité est récupérée depuis la zone physique correspondante.

Elle ne doit pas être stockée indépendamment dans chaque caméra.

Définir un TTL configurable pour les mesures.

Les mesures expirées ne participent pas à la moyenne.

Une caméra ne fournissant plus d'images valides doit être considérée comme indisponible.

Si aucune mesure valide n'existe :

`status = "unknown"`

Lorsqu'une capacité est modifiée, les occupations doivent être recalculées à partir des derniers comptages valides avant toute nouvelle fusion.

La fusion doit être isolée dans un composant indépendant afin de permettre ultérieurement d'autres stratégies.

---

# 8. API et données

Conserver et étendre l'API existante.

Ne pas créer une API parallèle si les fonctionnalités nécessaires existent déjà.

L'API doit respecter la séparation entre :

- **Zones physiques** : appartiennent au parking et possèdent la capacité maximale.
- **Caméras** : appartiennent au parking.
- **Associations caméra-zone** : contiennent uniquement la représentation polygonale de la zone pour une caméra donnée.

Les capacités doivent être modifiées exclusivement au niveau de la zone physique.

Une modification depuis l'interface d'une caméra doit donc mettre à jour la zone partagée, et non une propriété locale de la caméra.

Prévoir au minimum les opérations suivantes, en adaptant les routes à la structure actuelle :

### Administration

- Créer et modifier un parking.
- Créer, modifier et supprimer les zones physiques d'un parking.
- Modifier la capacité maximale d'une zone physique.
- Ajouter et configurer une caméra.
- Demander une capture de calibration anonymisée.
- Configurer les polygones propres à une caméra.
- Associer un polygone à une zone physique existante.
- Récupérer les zones existantes et leurs capacités pour permettre leur sélection depuis n'importe quelle caméra du parking.
- Sauvegarder et récupérer la carte schématique.

Lorsqu'une zone physique est modifiée, les changements doivent être visibles depuis toutes les caméras qui lui sont associées.

Éviter toute duplication persistante des capacités dans les configurations caméra.

### Exploitation

- Déclencher ou planifier une analyse.
- Récupérer les dernières occupations par caméra.
- Récupérer les occupations fusionnées.
- Consulter l'état des caméras.

Exemple de résultat d'une caméra :

```json
{
  "parking_id": "parking_1",
  "camera_id": "camera_1",
  "timestamp": "2026-10-31T11:00:00Z",
  "zones": [
    {
      "zone_id": "zone_1",
      "detected": 15,
      "occupancy": 0.75,
      "status": "valid"
    }
  ]
}
```

La capacité n'est pas une propriété de la caméra. Elle peut éventuellement être incluse dans une réponse API à titre informatif, mais doit toujours provenir de la zone physique partagée.

Exemple de résultat fusionné :

```json
{
  "parking_id": "parking_1",
  "zones": [
    {
      "zone_id": "zone_1",
      "capacity": 20,
      "occupancy": 0.80,
      "status": "valid",
      "camera_count": 3
    }
  ]
}
```

Ne pas confondre occupation estimée et nombre garanti de places libres.

---

# 9. Heatmap et frontend

Le frontend existant possède une représentation des parkings en vue du dessus.

Chaque zone du plan est associée à un `zone_id`.

L'occupation fusionnée fournie par le backend détermine la couleur de la zone correspondante.

Exemple de palette :

| Occupation | Couleur |
|---|---|
| 0–25 % | Vert |
| 25–50 % | Vert clair |
| 50–75 % | Jaune |
| 75–90 % | Orange |
| 90–100 % | Rouge |
| Unknown | Gris |

Les seuils peuvent être configurables.

Il faut distinguer clairement :

**Interface administrateur :**

- Configuration des parkings.
- Connexion aux caméras.
- Capture anonymisée.
- Configuration des polygones.
- Capacités et associations.
- Cartographie.

**Interface utilisateur :**

- Consultation des parkings.
- Visualisation des zones.
- Heatmap.
- Occupation estimée.

Aucune photographie de caméra n'est exposée à l'interface utilisateur.

Réutiliser les composants existants.

---

# 10. Exécution et gestion des caméras

Les ESP32-CAM doivent transmettre des images JPEG via un mécanisme compatible avec leur firmware.

Examiner les protocoles et endpoints déjà présents dans le projet.

Ne pas imposer un changement de protocole si la communication fonctionne déjà.

Prévoir :

- Un timeout de capture.
- Une gestion des erreurs réseau.
- Un statut de connexion.
- Une fréquence configurable d'analyse.
- La gestion de plusieurs caméras.
- L'expiration des mesures.
- L'absence de stockage permanent des images.

Le moteur YOLO doit être chargé une seule fois par processus d'inférence, et non à chaque capture.

Éviter les analyses concurrentes inutiles d'une même caméra.

Les captures et traitements doivent pouvoir être exécutés sans bloquer les requêtes normales du frontend.

Ne pas ajouter immédiatement de suivi temporel des vélos ou de mécanismes de correction complexes.

---

# 11. Contraintes de conception

Respecter impérativement les principes suivants :

1. **Frontend existant conservé.**
2. Backend responsable de toute l'analyse d'images.
3. YOLO26n utilisé par défaut.
4. Deface utilisé pour anonymiser les visages des images de calibration.
5. Aucune photographie persistée.
6. Attribution aux zones par recherche verticale de 95 % à 65 %.
7. **Zones physiques partagées au niveau du parking, avec une capacité maximale unique par zone.**
8. **Polygones propres à chaque caméra, associés aux zones physiques partagées.**
9. Fusion multi-caméras par moyenne des occupations valides.
10. Zones reliées par `parking_id + zone_id`.
11. Heatmap basée sur les occupations fusionnées.
12. Configuration persistante et indépendante du modèle YOLO.
13. Aucun traitement de reconnaissance ou de suivi des personnes.

Ne pas implémenter de simulation avec des vélos fictifs.

Ne pas implémenter de sliders de calibration des points d'ancrage.

Ne pas développer de modèle de segmentation ou de détection individuelle des places.

Ne pas entraîner un nouveau modèle pour cette tâche.

Ne pas ajouter de fonctionnalités expérimentales sans utilité immédiate.

Privilégier un code lisible, typé lorsque pertinent, modulaire et correctement intégré au projet.

---

# 12. Implémentation et validation

Travaille directement dans le dépôt existant.

Commence par identifier précisément :

- Les fonctionnalités déjà présentes.
- La stack frontend/backend.
- Les modèles de données.
- Les composants de cartographie.
- Les mécanismes de communication avec les caméras.
- Les endpoints disponibles.
- Les dépendances et les modèles déjà installés.

Ensuite, implémente uniquement ce qui manque.

**Tests indispensables :**

### Attribution géométrique

- Vélo entièrement dans une zone.
- Point à 95 % hors zone, mais point à 85 % dans la zone.
- Vélo hors de toutes les zones.
- Vélo sur une frontière.
- Plusieurs vélos dans une même zone.
- Coordonnées normalisées et pixels.
- Polygones invalides ou superposés.

### Zones et capacités

- Création d'une zone physique depuis une première caméra.
- Association de cette même zone à une deuxième caméra.
- Polygones différents pour une même zone physique.
- Capacité identique pour toutes les caméras associées.
- Modification de la capacité depuis une caméra et répercussion sur toutes les autres.
- Absence de duplication persistante des capacités.
- Capacité invalide.

### Occupation

- Zone vide.
- Zone partiellement occupée.
- Zone complète.
- Nombre de détections supérieur à la capacité.
- Recalcul des occupations après modification de la capacité partagée.

### Fusion

- Une caméra.
- Plusieurs caméras.
- Comptages différents avec capacité commune.
- Caméra déconnectée.
- Mesure expirée.
- Aucune mesure valide.
- Modification de la capacité commune et mise à jour de l'occupation fusionnée.

### Confidentialité

- Capture brute jamais exposée au frontend.
- Deface appliqué avant tout affichage d'une capture.
- Échec de Deface empêchant la transmission de l'image.
- Aucun fichier image temporaire ou persistant.
- Aucun contenu image dans les logs.
- Réponses de calibration non mises en cache.

Utilise des images synthétiques pour les tests géométriques et de confidentialité, ainsi que des images publiques autorisées pour les tests réels d'inférence.

Si aucune ESP32-CAM n'est disponible pendant le développement, isole la couche d'acquisition et teste le reste avec un fournisseur d'images local de développement. Celui-ci ne doit pas être utilisé pour enregistrer les captures réelles.

Exécute réellement les tests et corrige les problèmes.

## Résultat attendu

Une V1 fonctionnelle intégrée au projet actuel, capable de :

1. Connecter une caméra.
2. Capturer et anonymiser une image pour la calibration.
3. Configurer des zones physiques partagées, leurs capacités et leurs représentations polygonales propres à chaque caméra.
4. Analyser les captures avec YOLO26n.
5. Attribuer les vélos aux zones.
6. Calculer les occupations avec la capacité commune de chaque zone.
7. Fusionner les résultats de plusieurs caméras.
8. Alimenter la heatmap existante.
9. Fonctionner sans stockage permanent de photographies.

À la fin, indique les fichiers modifiés, les fonctionnalités implémentées, les tests exécutés et les éventuelles limitations.

**Implémente le système dans le projet existant. Ne te limite pas à produire un plan ou du pseudo-code.**
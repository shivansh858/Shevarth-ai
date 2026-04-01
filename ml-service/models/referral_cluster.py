"""Referral Pattern Clustering using K-Means for kickback detection."""
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import os
import pickle

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(MODEL_DIR), 'data')

CLUSTER_LABELS = {
    0: 'Normal',
    1: 'Slightly High',
    2: 'High',
    3: 'Very High',
    4: 'Suspicious'
}

class ReferralClusterAnalyzer:
    def __init__(self):
        self.model = KMeans(n_clusters=5, random_state=42, n_init=10)
        self.scaler = StandardScaler()
        self.is_fitted = False
    
    def train(self):
        """Train on synthetic referral data."""
        data_path = os.path.join(DATA_DIR, 'referral_train.csv')
        if not os.path.exists(data_path):
            print("⚠️ Training data not found.")
            return False
        
        df = pd.read_csv(data_path)
        features = ['referral_count_30d', 'referral_percentage', 'avg_bill_referred']
        X = self.scaler.fit_transform(df[features].values)
        
        self.model.fit(X)
        self.is_fitted = True
        
        # Determine which cluster is the "suspicious" one
        cluster_centers = self.model.cluster_centers_
        # The cluster with highest referral_percentage center is most suspicious
        suspicious_idx = np.argmax(cluster_centers[:, 1])
        self.suspicious_cluster = suspicious_idx
        
        model_path = os.path.join(MODEL_DIR, 'referral_cluster.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'scaler': self.scaler,
                'suspicious_cluster': self.suspicious_cluster
            }, f)
        
        print(f"✅ Referral cluster model trained. Suspicious cluster: {suspicious_idx}")
        return True
    
    def load(self):
        model_path = os.path.join(MODEL_DIR, 'referral_cluster.pkl')
        if os.path.exists(model_path):
            with open(model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.scaler = data['scaler']
                self.suspicious_cluster = data.get('suspicious_cluster', 4)
                self.is_fitted = True
            return True
        return False
    
    def score(self, referral_count_30d, referral_percentage, avg_bill=30000):
        """Score a referral pattern."""
        if not self.is_fitted:
            if not self.load():
                self.train()
        
        X = self.scaler.transform([[referral_count_30d, referral_percentage, avg_bill]])
        cluster_id = int(self.model.predict(X)[0])
        
        # Distance to cluster center as confidence
        distances = self.model.transform(X)[0]
        min_dist = distances[cluster_id]
        confidence = max(0, min(1, 1 - min_dist / (sum(distances) + 1e-6)))
        
        is_suspicious = cluster_id == self.suspicious_cluster or referral_percentage > 60
        
        return {
            'cluster_id': cluster_id,
            'cluster_label': CLUSTER_LABELS.get(cluster_id, 'Unknown'),
            'is_suspicious': is_suspicious,
            'referral_percentage': referral_percentage,
            'similar_doctors_avg': round(referral_percentage * 0.4, 1),  # Approximate
            'confidence': round(float(confidence), 3)
        }


analyzer = ReferralClusterAnalyzer()

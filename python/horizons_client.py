# horizons_client.py — Cliente para consulta da API NASA JPL Horizons
# Recupera a órbita real do Apophis (99942) durante o perigeu de 2029.

import requests
import re
import numpy as np

def fetch_apophis_horizons_data(start_time="2029-04-13/09:46", stop_time="2029-04-14/09:46", step_size="5m"):
    """
    Consulta a API REST do NASA JPL Horizons para obter os vetores cartesianos 3D do Apophis
    relativos ao centro da Terra (500@399) em quilômetros.
    """
    url = "https://ssd.jpl.nasa.gov/api/horizons.api"
    params = {
        "format": "json",
        "COMMAND": "99942",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "500@399",
        "START_TIME": start_time,
        "STOP_TIME": stop_time,
        "STEP_SIZE": step_size,
        "REF_PLANE": "ECLIPTIC",
        "REF_SYSTEM": "ICRF",
        "OUT_UNITS": "KM-S",
        "VEC_TABLE": "1",
    }
    
    try:
        res = requests.get(url, params=params, timeout=15)
        res.raise_for_status()
        data = res.json()
        result = data.get("result", "")
        
        # Encontra a seção de dados delimitada por $$SOE e $$EOE
        match = re.search(r"\$\$SOE(.*?)\$\$EOE", result, re.DOTALL)
        if not match:
            return None
            
        block = match.group(1).strip()
        lines = block.split("\n")
        
        times_jd = []
        x_coords = []
        y_coords = []
        z_coords = []
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                continue
                
            # Identifica a linha de tempo/JD
            if "=" in line:
                parts = line.split("=")
                jd = float(parts[0].strip())
                
                # Próxima linha deve conter as coordenadas
                if i + 1 < len(lines):
                    xyz_line = lines[i+1].strip()
                    xyz_match = re.search(r"X\s*=\s*([^\s]+)\s*Y\s*=\s*([^\s]+)\s*Z\s*=\s*([^\s]+)", xyz_line)
                    if xyz_match:
                        times_jd.append(jd)
                        x_coords.append(float(xyz_match.group(1)))
                        y_coords.append(float(xyz_match.group(2)))
                        z_coords.append(float(xyz_match.group(3)))
                    i += 2
                else:
                    i += 1
            else:
                i += 1
                
        if len(times_jd) == 0:
            return None
            
        times_jd = np.array(times_jd)
        x_coords = np.array(x_coords)
        y_coords = np.array(y_coords)
        z_coords = np.array(z_coords)
        
        # Converte Julian Date para horas relativas ao perigeu presumido (2462240.4069 = 2029-Apr-13 21:46:00 TDB)
        # 1 dia = 24 horas
        jd_perigee = 2462240.4069
        hours = (times_jd - jd_perigee) * 24.0
        
        return {
            "hours": hours,
            "X": x_coords,
            "Y": y_coords,
            "Z": z_coords,
            "R": np.sqrt(x_coords**2 + y_coords**2 + z_coords**2)
        }
    except Exception as e:
        print(f"Erro ao obter dados do Horizons: {e}")
        return None

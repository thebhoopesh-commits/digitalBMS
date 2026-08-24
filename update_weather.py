import re

with open('src/simulation/physics/weather.py', 'r', encoding='utf-8') as f:
    content = f.read()

open_meteo_code = '''
class OpenMeteoClient:
    \"\"\"Fetches live weather data from Open-Meteo for the REAL_TIME preset.\"\"\"
    def __init__(self, latitude=40.7143, longitude=-74.006):
        self.latitude = latitude
        self.longitude = longitude
        self._cache = None
        self._last_fetch_time = 0.0

    def fetch_24h_data(self):
        import time, urllib.request, json
        # Simple cache for 1 hour
        if self._cache and (time.time() - self._last_fetch_time < 3600):
            return self._cache

        url = f"https://api.open-meteo.com/v1/forecast?latitude={self.latitude}&longitude={self.longitude}&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation"
        try:
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode())
                hourly = data["hourly"]
                self._cache = {
                    "temps": hourly["temperature_2m"][:25],
                    "rh": hourly["relative_humidity_2m"][:25],
                    "solar": hourly["shortwave_radiation"][:25],
                }
                self._last_fetch_time = time.time()
                return self._cache
        except Exception as e:
            import logging
            logging.getLogger("hvac.weather").warning(f"Failed to fetch live weather: {e}")
            # Fallback data
            return {
                "temps": [22.0] * 25,
                "rh": [50.0] * 25,
                "solar": [0.0] * 25,
            }

    def get_interpolated_values(self, sim_hour: float):
        data = self.fetch_24h_data()
        h = sim_hour % 24.0
        idx1 = int(h)
        idx2 = (idx1 + 1) % 24
        t = h - idx1
        
        # Linear interpolation
        temp = data["temps"][idx1] * (1 - t) + data["temps"][idx2] * t
        rh = data["rh"][idx1] * (1 - t) + data["rh"][idx2] * t
        solar = data["solar"][idx1] * (1 - t) + data["solar"][idx2] * t
        return temp, rh, solar
'''

# Add OpenMeteoClient before WeatherGenerator
idx = content.find('class WeatherGenerator:')
content = content[:idx] + open_meteo_code + '\n\n' + content[idx:]

# In WeatherGenerator.__init__, initialize OpenMeteoClient
init_idx = content.find('self.rng = np.random.default_rng(seed)')
content = content[:init_idx] + 'self.live_weather_client = OpenMeteoClient()\n        ' + content[init_idx:]

# In _load_preset_params, if preset is REAL_TIME, we don't need params from PRESET_PARAMS
preset_params_code = '''    def _load_preset_params(self, preset: WeatherPreset) -> None:
        """Loads physical atmospheric parameters for the specified weather preset."""
        if preset == WeatherPreset.REAL_TIME:
            self.t_mean = 22.0
            self.t_amp = 0.0
            self.rh_mean = 50.0
            self.rh_amp = 0.0
            self.i_max = 800.0
            self.cloud_cover = 0.2
            self.solar_factor = 1.0
            return
        
        params = self.PRESET_PARAMS[preset]'''
content = re.sub(r'    def _load_preset_params\(self, preset: WeatherPreset\) -> None:.*?params = self.PRESET_PARAMS\[preset\]', preset_params_code, content, flags=re.DOTALL)

# In step(), handle REAL_TIME preset
step_logic_old = '''        # 2. Outdoor Ambient Temperature: sinusoidal peak at 15:00 (3 PM), min at 03:00 (3 AM)
        t_diurnal = self.t_mean + self.t_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
        outdoor_temp = float(t_diurnal + self.ou_state_temp)

        # 3. Solar Irradiance: positive half-sine between 06:00 and 18:00
        if 6.0 <= sim_hour <= 18.0:
            solar_sin = math.sin(0.2617993877991494 * (sim_hour - 6.0))
            solar_irradiance = float(self.i_max * max(0.0, solar_sin) * self.solar_factor)
        else:
            solar_irradiance = 0.0

        # 4. Ambient Relative Humidity: inverse to temperature
        rh_diurnal = self.rh_mean - self.rh_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
        outdoor_rh = max(10.0, min(100.0, float(rh_diurnal + self.ou_state_rh)))'''

step_logic_new = '''        if self.preset == WeatherPreset.REAL_TIME:
            live_temp, live_rh, live_solar = self.live_weather_client.get_interpolated_values(sim_hour)
            outdoor_temp = float(live_temp + self.ou_state_temp)
            outdoor_rh = max(10.0, min(100.0, float(live_rh + self.ou_state_rh)))
            solar_irradiance = float(live_solar)
        else:
            # 2. Outdoor Ambient Temperature: sinusoidal peak at 15:00 (3 PM), min at 03:00 (3 AM)
            t_diurnal = self.t_mean + self.t_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
            outdoor_temp = float(t_diurnal + self.ou_state_temp)
    
            # 3. Solar Irradiance: positive half-sine between 06:00 and 18:00
            if 6.0 <= sim_hour <= 18.0:
                solar_sin = math.sin(0.2617993877991494 * (sim_hour - 6.0))
                solar_irradiance = float(self.i_max * max(0.0, solar_sin) * self.solar_factor)
            else:
                solar_irradiance = 0.0
    
            # 4. Ambient Relative Humidity: inverse to temperature
            rh_diurnal = self.rh_mean - self.rh_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
            outdoor_rh = max(10.0, min(100.0, float(rh_diurnal + self.ou_state_rh)))'''
content = content.replace(step_logic_old, step_logic_new)

with open('src/simulation/physics/weather.py', 'w', encoding='utf-8') as f:
    f.write(content)

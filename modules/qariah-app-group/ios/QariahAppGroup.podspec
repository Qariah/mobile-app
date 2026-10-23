Pod::Spec.new do |s|
  s.name           = 'QariahAppGroup'
  s.version        = '1.0.0'
  s.summary        = 'Qariah: the one-time move of the beta App Group data'
  s.description    = 'Copies the data of the internal beta from the production App Group to its own App Group at the first launch (TECH_DEBT #289).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
